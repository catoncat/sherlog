//! Explicit, writer-side v7 -> v8 copy migration.
//!
//! Merely opening an index reader never invokes this module. Callers must enter
//! through [`migrate_v7_to_v8`] from an authorized writer path (normally
//! `sync`). The active v7 database remains valid until a fully copied, checked,
//! fsynced v8 database is atomically published.

mod artifacts;
mod cold_fence;
mod error;
mod legacy;
mod verify;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use serde::Serialize;

use crate::cold::{COLD_ROOTS_VERSION, ColdRootEntry, cold_roots_path_for_db};
use crate::config::{INDEX_VERSION, resolve_lexical};
use crate::identity::SourceId;
use crate::index::{IndexWriter, SCHEMA_VERSION};

use artifacts::{
    LegacyWriterLock, MigrationArtifacts, append_suffix, confirm_publication_durability,
    consolidate_active_v7, create_consistent_backup, ensure_supported_platform, match_permissions,
    prepare_staging, preserve_sealed_database, publish_next, quarantine_database_group,
    quarantine_staging, remove_empty_staging, remove_stale_backups, restore_backup_atomically,
    seal_next,
};
pub(crate) use cold_fence::ColdConfigFence;
pub use error::{MigrationError, MigrationResult};
use legacy::{
    SourceLayout, copy_v7_projection, fingerprint_v7, inspect_source_layout, preflight_v7,
};
use verify::verify_v8_copy;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationRequest {
    pub active_db: PathBuf,
    pub cold_roots_config: PathBuf,
    /// Used only to resolve any legacy relative roots in cold-roots.json.
    pub cwd: PathBuf,
}

impl MigrationRequest {
    pub fn for_database(active_db: impl Into<PathBuf>, cwd: impl Into<PathBuf>) -> Self {
        let active_db = active_db.into();
        let cwd = cwd.into();
        let cold_roots_config = cold_roots_path_for_db(&active_db, &cwd);
        Self {
            active_db,
            cold_roots_config,
            cwd,
        }
    }

    pub fn with_cold_roots_config(mut self, path: impl Into<PathBuf>) -> Self {
        self.cold_roots_config = path.into();
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub active_db: PathBuf,
    pub backup_db: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quarantined_preexisting_next: Option<PathBuf>,
    pub from_schema_version: i32,
    pub to_schema_version: i32,
    pub index_version: String,
    pub source_fingerprint: String,
    pub session_count: u64,
    pub message_count: u64,
    pub document_count: u64,
    pub source_file_count: u64,
    pub cold_root_count: u64,
    pub coverage_rows_cleared: u64,
    pub fts_row_count: u64,
    pub representative_fts_checks: u64,
}

/// Build and atomically publish a v8 database. This function is intentionally
/// explicit: read-only commands must never call it.
pub fn migrate_v7_to_v8(request: &MigrationRequest) -> MigrationResult<MigrationReport> {
    migrate_with_failure(request, None)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FailurePoint {
    AfterBackup,
    AfterCopy,
    BeforePublish,
    AfterColdFence,
    AfterPublish,
}

fn migrate_with_failure(
    request: &MigrationRequest,
    failure: Option<FailurePoint>,
) -> MigrationResult<MigrationReport> {
    ensure_supported_platform()?;
    if !request.active_db.exists() {
        return Err(MigrationError::NotFound(request.active_db.clone()));
    }
    let artifacts = MigrationArtifacts::for_active(&request.active_db);
    let _lock = LegacyWriterLock::acquire(&request.active_db)?;

    match inspect_source_layout(&request.active_db)? {
        SourceLayout::V7 => {}
        SourceLayout::V8 => return Err(MigrationError::AlreadyV8(request.active_db.clone())),
        SourceLayout::Unsupported(detail) => {
            return Err(MigrationError::UnsupportedSource {
                path: request.active_db.clone(),
                detail,
            });
        }
    }

    let stale_failed = append_suffix(&artifacts.failed_next, ".preexisting");
    let quarantined_preexisting_next =
        quarantine_database_group(&artifacts.canonical_next, &stale_failed)?;
    // Earlier releases of this migrator refused to start on legacy v7 tables
    // without the 0.3.15 `source_file_set_fingerprint` column. Every failed
    // attempt left a fresh backup behind, so affected users may have several
    // byte-identical `.v7.bak.*` files crowding the data directory. Retain at
    // most the newest one (plus a read-only snapshot copy) before writing any
    // new artifacts.
    remove_stale_backups(&request.active_db)?;
    let mut cold_fence = ColdConfigFence::inspect(&request.cold_roots_config)?;
    let cold_roots = cold_fence.cold_roots(&request.cwd)?;
    prepare_staging(&artifacts)?;

    let outcome = migrate_locked(
        request,
        &artifacts,
        &cold_roots,
        &mut cold_fence,
        failure,
        quarantined_preexisting_next.clone(),
    );
    if outcome.is_err() {
        // Never delete a partially built database. Keep it with its WAL/SHM so
        // the failure can be inspected, while freeing the canonical `.next`
        // name for a later explicit retry.
        let _ = quarantine_staging(&artifacts.staging_dir, &artifacts.failed_next);
    }
    outcome
}

fn migrate_locked(
    request: &MigrationRequest,
    artifacts: &MigrationArtifacts,
    cold_roots: &[crate::cold::ColdRootEntry],
    cold_fence: &mut ColdConfigFence,
    failure: Option<FailurePoint>,
    quarantined_preexisting_next: Option<PathBuf>,
) -> MigrationResult<MigrationReport> {
    preflight_v7(&request.active_db)?;
    create_consistent_backup(&request.active_db, &artifacts.backup)?;
    preflight_v7(&artifacts.backup)?;
    let active_at_start = fingerprint_v7(&request.active_db)?;
    let backup_fingerprint = fingerprint_v7(&artifacts.backup)?;
    if active_at_start != backup_fingerprint {
        return Err(MigrationError::Verification(format!(
            "standalone v7 backup differs from active snapshot: active={active_at_start:?} backup={backup_fingerprint:?}"
        )));
    }
    inject(failure, FailurePoint::AfterBackup)?;

    let mut writer = IndexWriter::create_v8(&artifacts.next)?;
    // The scratch database contains the same private conversations as active;
    // do not leave it with broader create-default permissions while copying.
    match_permissions(&artifacts.next, &request.active_db)?;
    let copy = copy_v7_projection(&artifacts.backup, &mut writer, cold_roots)?;
    let migration_receipt = serde_json::json!({
        "fromSchemaVersion": 7,
        "toSchemaVersion": SCHEMA_VERSION,
        "sourceFingerprint": copy.source.digest,
        "sessionCount": copy.source.session_count,
        "messageCount": copy.source.message_count,
        "sourceFileCount": copy.source.source_file_count,
        "coldRootCount": copy.cold_root_count,
        "coverageDisposition": "cleared",
        "coverageRowsCleared": copy.source.coverage_count,
        "indexVersion": INDEX_VERSION,
    });
    writer.set_migration_receipt(&migration_receipt.to_string())?;
    drop(writer);
    inject(failure, FailurePoint::AfterCopy)?;

    let verified = verify_v8_copy(&artifacts.backup, &artifacts.next, &copy.source, cold_roots)?;
    if copy.receipt.invariants.session_count != verified.session_count
        || copy.receipt.invariants.message_document_count != verified.message_count
        || copy.receipt.invariants.fts_row_count != verified.fts_row_count
    {
        return Err(MigrationError::Verification(
            "transaction receipt and independent verifier disagree".to_owned(),
        ));
    }
    seal_next(&artifacts.next, &request.active_db)?;

    cold_fence.preflight()?;
    let active_before_publish = fingerprint_v7(&request.active_db)?;
    if active_before_publish != backup_fingerprint {
        return Err(MigrationError::SourceChanged(format!(
            "active v7 fingerprint was {} and is now {}",
            backup_fingerprint.digest, active_before_publish.digest
        )));
    }
    consolidate_active_v7(&request.active_db)?;
    let active_after_checkpoint = fingerprint_v7(&request.active_db)?;
    if active_after_checkpoint != backup_fingerprint {
        return Err(MigrationError::Verification(
            "checkpoint changed active v7 logical content".to_owned(),
        ));
    }
    cold_fence.verify()?;
    inject(failure, FailurePoint::BeforePublish)?;

    cold_fence.publish()?;
    inject(failure, FailurePoint::AfterColdFence)?;
    publish_next(&artifacts.next, &request.active_db)?;
    if let Err(error) = confirm_publication_durability(&request.active_db, &artifacts.staging_dir) {
        return Err(MigrationError::PublishedButDurabilityUnknown {
            active: request.active_db.clone(),
            backup: artifacts.backup.clone(),
            detail: error.to_string(),
        });
    }
    let post_publish_verification = cold_fence
        .complete()
        .and_then(|()| inject(failure, FailurePoint::AfterPublish))
        .and_then(|()| {
            verify_v8_copy(
                &artifacts.backup,
                &request.active_db,
                &copy.source,
                cold_roots,
            )
        });
    let verified = match post_publish_verification {
        Ok(verified) => verified,
        Err(error) => {
            let failed_published = append_suffix(
                &request.active_db,
                &format!(".v8.failed.{}", artifacts.run_id),
            );
            // The v8 copy was already sealed, so a plain file copy is sufficient
            // to retain diagnostic evidence. Restoration itself never removes the
            // canonical active path and leaves the verified backup intact.
            let preserved_failed =
                preserve_sealed_database(&request.active_db, &failed_published).is_ok();
            let restore_copy = artifacts.staging_dir.join("restore.sqlite");
            restore_backup_atomically(&artifacts.backup, &request.active_db, &restore_copy)
                .map_err(|rollback_error| MigrationError::Publish(format!(
                    "post-publish verification failed ({error}); atomic v7 restore failed: {rollback_error}; verified backup remains at {}",
                    artifacts.backup.display()
                )))?;
            return Err(MigrationError::Publish(format!(
                "post-publish verification failed and v7 was atomically restored; failed v8 preserved={preserved_failed} at {}: {error}",
                failed_published.display(),
            )));
        }
    };

    // Publication and post-verification have succeeded. Failure to remove an
    // empty private run directory must not be reported as migration failure,
    // because the durable active database is already v8.
    let _ = remove_empty_staging(&artifacts.staging_dir);

    Ok(MigrationReport {
        active_db: request.active_db.clone(),
        backup_db: artifacts.backup.clone(),
        quarantined_preexisting_next,
        from_schema_version: 7,
        to_schema_version: SCHEMA_VERSION,
        index_version: INDEX_VERSION.to_owned(),
        source_fingerprint: copy.source.digest,
        session_count: verified.session_count,
        message_count: verified.message_count,
        document_count: verified.document_count,
        source_file_count: verified.source_file_count,
        cold_root_count: verified.cold_root_count,
        coverage_rows_cleared: copy.source.coverage_count,
        fts_row_count: verified.fts_row_count,
        representative_fts_checks: verified.representative_fts_checks,
    })
}

fn inject(actual: Option<FailurePoint>, expected: FailurePoint) -> MigrationResult<()> {
    if actual != Some(expected) {
        return Ok(());
    }
    #[cfg(test)]
    {
        Err(MigrationError::Injected(match expected {
            FailurePoint::AfterBackup => "after_backup",
            FailurePoint::AfterCopy => "after_copy",
            FailurePoint::BeforePublish => "before_publish",
            FailurePoint::AfterColdFence => "after_cold_fence",
            FailurePoint::AfterPublish => "after_publish",
        }))
    }
    #[cfg(not(test))]
    unreachable!("failure injection is test-only")
}

fn load_cold_roots_strict(
    bytes: Option<&[u8]>,
    path: &Path,
    cwd: &Path,
) -> MigrationResult<Vec<ColdRootEntry>> {
    let Some(bytes) = bytes else {
        return Ok(Vec::new());
    };
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|error| {
        MigrationError::ColdConfig(format!("cannot parse {}: {error}", path.display()))
    })?;
    let object = value.as_object().ok_or_else(|| {
        MigrationError::ColdConfig(format!("{} must contain a JSON object", path.display()))
    })?;
    let version = object
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            MigrationError::ColdConfig(format!(
                "{} must contain an integer version",
                path.display()
            ))
        })?;
    if version != COLD_ROOTS_VERSION {
        return Err(MigrationError::ColdConfig(format!(
            "{} has unsupported version {version}; expected {COLD_ROOTS_VERSION}",
            path.display()
        )));
    }
    let roots = object
        .get("roots")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| {
            MigrationError::ColdConfig(format!("{} roots must be an array", path.display()))
        })?;
    let mut result = Vec::with_capacity(roots.len());
    let mut unique = HashSet::with_capacity(roots.len());
    for (index, value) in roots.iter().enumerate() {
        let entry = value.as_object().ok_or_else(|| {
            MigrationError::ColdConfig(format!(
                "{} roots[{index}] must be an object",
                path.display()
            ))
        })?;
        let raw_root = required_nonempty_string(entry.get("root"), path, index, "root")?;
        let source_text = match entry.get("sourceId") {
            // Compatibility with the original Codex-only cold-roots format.
            None => "codex",
            value => required_nonempty_string(value, path, index, "sourceId")?,
        };
        let source = SourceId::from_str(source_text).map_err(|error| {
            MigrationError::ColdConfig(format!(
                "{} roots[{index}].sourceId: {error}",
                path.display()
            ))
        })?;
        let added_at = match entry.get("addedAt") {
            // Compatibility with legacy entries written before timestamps were
            // introduced, while still rejecting malformed present fields.
            None => "1970-01-01T00:00:00.000Z",
            value => required_nonempty_string(value, path, index, "addedAt")?,
        };
        added_at.parse::<jiff::Timestamp>().map_err(|error| {
            MigrationError::ColdConfig(format!(
                "{} roots[{index}].addedAt is invalid: {error}",
                path.display()
            ))
        })?;
        let resolved = resolve_lexical(raw_root, cwd);
        let root = resolved
            .to_str()
            .ok_or_else(|| MigrationError::NonUtf8Path(resolved.clone()))?
            .to_owned();
        if !unique.insert((source, root.clone())) {
            return Err(MigrationError::ColdConfig(format!(
                "{} contains duplicate cold root {}:{root}",
                path.display(),
                source.as_str()
            )));
        }
        result.push(ColdRootEntry {
            source_id: source.as_str().to_owned(),
            root,
            added_at: added_at.to_owned(),
        });
    }
    Ok(result)
}

fn required_nonempty_string<'a>(
    value: Option<&'a serde_json::Value>,
    path: &Path,
    index: usize,
    field: &str,
) -> MigrationResult<&'a str> {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            MigrationError::ColdConfig(format!(
                "{} roots[{index}].{field} must be a non-empty string",
                path.display()
            ))
        })
}

#[cfg(test)]
mod tests;
