use std::ffi::{OsStr, OsString};
use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::DirBuilderExt;

use jiff::Timestamp;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::sync::SyncLock;

use super::error::{MigrationError, MigrationResult};

const LOCK_SUFFIX: &str = ".sync.lock";

/// How long a `.v7.bak.*` backup stays exempt from stale-backup cleanup.
const BACKUP_GRACE_PERIOD: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug)]
pub(super) struct MigrationArtifacts {
    pub canonical_next: PathBuf,
    pub staging_dir: PathBuf,
    pub next: PathBuf,
    pub backup: PathBuf,
    pub failed_next: PathBuf,
    pub run_id: String,
}

impl MigrationArtifacts {
    pub fn for_active(active: &Path) -> Self {
        let run_id = run_id();
        let staging_dir = append_suffix(active, &format!(".migrate.{run_id}"));
        Self {
            canonical_next: append_suffix(active, ".next"),
            next: staging_dir.join("index.sqlite.next"),
            staging_dir,
            backup: append_suffix(active, &format!(".v7.bak.{run_id}")),
            failed_next: append_suffix(active, &format!(".next.failed.{run_id}")),
            run_id,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LockInfo {
    pid: u32,
    created_at: String,
}

/// Compatible with both the TypeScript and Rust sync writers. The complete
/// owner payload is written to a unique claim first, then hard-linked into the
/// legacy regular-file lock path. That link is atomic create-if-absent, so the
/// canonical lock can never be observed empty or partially written.
pub(super) struct LegacyWriterLock {
    path: PathBuf,
    encoded_owner: Vec<u8>,
}

impl LegacyWriterLock {
    pub fn acquire(active: &Path) -> MigrationResult<Self> {
        let path = append_suffix(active, LOCK_SUFFIX);
        let timestamp = Timestamp::now();
        let created_at = timestamp.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        let info = LockInfo {
            pid: process::id(),
            created_at,
        };
        let encoded_owner = serde_json::to_vec(&info)
            .map_err(|error| MigrationError::Publish(format!("encode writer lock: {error}")))?;
        let claim_path = append_suffix(&path, &format!(".claim.{}", run_id()));
        let mut claim = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&claim_path)?;
        if let Err(error) = claim
            .write_all(&encoded_owner)
            .and_then(|()| claim.sync_all())
        {
            drop(claim);
            let _ = fs::remove_file(&claim_path);
            return Err(error.into());
        }
        drop(claim);

        let publish_claim = || fs::hard_link(&claim_path, &path);
        match publish_claim() {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if lock_claimed_by_current_process(&path) {
                    let _ = fs::remove_file(&claim_path);
                    return Err(MigrationError::LockBusy(path));
                }
                // Let the shared lock implementation conservatively wait for
                // live owners and reclaim a proved-dead legacy/directory lock.
                // Drop its temporary directory claim, then atomically compete
                // for the regular-file form used here. Normal migration
                // acquisition stays atomic so already-released TypeScript
                // directory writers cannot enter the mkdir/owner-file race.
                let recovery = match SyncLock::acquire(active) {
                    Ok(recovery) => recovery,
                    Err(_) => {
                        let _ = fs::remove_file(&claim_path);
                        return Err(MigrationError::LockBusy(path));
                    }
                };
                drop(recovery);
                match publish_claim() {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                        let _ = fs::remove_file(&claim_path);
                        return Err(MigrationError::LockBusy(path));
                    }
                    Err(error) => {
                        let _ = fs::remove_file(&claim_path);
                        return Err(error.into());
                    }
                }
            }
            Err(error) => {
                let _ = fs::remove_file(&claim_path);
                return Err(error.into());
            }
        }
        let _ = fs::remove_file(&claim_path);
        if let Err(error) = sync_parent(&path) {
            if fs::read(&path).ok().as_deref() == Some(encoded_owner.as_slice()) {
                let _ = fs::remove_file(&path);
            }
            return Err(error);
        }
        Ok(Self {
            path,
            encoded_owner,
        })
    }
}

fn lock_claimed_by_current_process(path: &Path) -> bool {
    if path.is_file() {
        return fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<LockInfo>(&bytes).ok())
            .is_some_and(|info| info.pid == process::id());
    }
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    entries.filter_map(Result::ok).any(|entry| {
        fs::read(entry.path())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<LockInfo>(&bytes).ok())
            .is_some_and(|info| info.pid == process::id())
    })
}

impl Drop for LegacyWriterLock {
    fn drop(&mut self) {
        if fs::read(&self.path).ok().as_deref() == Some(self.encoded_owner.as_slice()) {
            let _ = fs::remove_file(&self.path);
            let _ = sync_parent(&self.path);
        }
    }
}

pub(super) fn prepare_staging(artifacts: &MigrationArtifacts) -> MigrationResult<()> {
    let mut builder = DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    match builder.create(&artifacts.staging_dir) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(MigrationError::ArtifactExists(
                artifacts.staging_dir.clone(),
            ));
        }
        Err(error) => return Err(error.into()),
    }
    if let Err(error) = sync_parent(&artifacts.staging_dir) {
        let _ = fs::remove_dir(&artifacts.staging_dir);
        return Err(error);
    }
    Ok(())
}

pub(super) fn ensure_supported_platform() -> MigrationResult<()> {
    #[cfg(unix)]
    {
        Ok(())
    }
    #[cfg(not(unix))]
    {
        Err(MigrationError::UnsupportedPlatform(
            "v7 -> v8 publication is currently supported only on Unix; atomic replacement and directory fsync have not been proved on this platform"
                .to_owned(),
        ))
    }
}

pub(super) fn create_consistent_backup(active: &Path, backup: &Path) -> MigrationResult<()> {
    let backup_text = backup
        .to_str()
        .ok_or_else(|| MigrationError::NonUtf8Path(backup.to_path_buf()))?;
    // Reserve the unique artifact and apply the active index's permissions
    // before SQLite writes any private conversation data into it. SQLite
    // explicitly permits VACUUM INTO an existing empty file.
    match OpenOptions::new().write(true).create_new(true).open(backup) {
        Ok(file) => {
            drop(file);
            match_permissions(backup, active)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(MigrationError::ArtifactExists(backup.to_path_buf()));
        }
        Err(error) => return Err(error.into()),
    }
    let connection = Connection::open_with_flags(
        active,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute("VACUUM INTO ?", [backup_text])?;
    connection
        .close()
        .map_err(|(_, error)| MigrationError::Sqlite(error))?;
    sync_file(backup)?;
    sync_parent(backup)?;
    Ok(())
}

/// Consolidate any old WAL only after a standalone v7 backup exists.  This
/// changes no logical rows, but prevents a stale `index.sqlite-wal` from being
/// mistaken for the newly published v8 database's WAL.
pub(super) fn consolidate_active_v7(active: &Path) -> MigrationResult<()> {
    let connection = Connection::open_with_flags(
        active,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    checkpoint_to_delete(&connection, "active v7")?;
    connection
        .close()
        .map_err(|(_, error)| MigrationError::Sqlite(error))?;
    remove_sidecar_if_present(active, "-wal")?;
    remove_sidecar_if_present(active, "-shm")?;
    sync_file(active)?;
    sync_parent(active)?;
    Ok(())
}

pub(super) fn seal_next(next: &Path, active: &Path) -> MigrationResult<()> {
    let connection = Connection::open_with_flags(
        next,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.execute(
        "INSERT INTO documents_fts(documents_fts) VALUES('integrity-check')",
        [],
    )?;
    checkpoint_to_delete(&connection, "v8 next")?;
    connection.pragma_update(None, "synchronous", "FULL")?;
    connection
        .close()
        .map_err(|(_, error)| MigrationError::Sqlite(error))?;
    remove_sidecar_if_present(next, "-wal")?;
    remove_sidecar_if_present(next, "-shm")?;
    match_permissions(next, active)?;
    sync_file(next)?;
    sync_parent(next)?;
    Ok(())
}

pub(super) fn match_permissions(path: &Path, reference: &Path) -> MigrationResult<()> {
    fs::set_permissions(path, fs::metadata(reference)?.permissions())?;
    Ok(())
}

pub(super) fn publish_next(next: &Path, active: &Path) -> MigrationResult<()> {
    // On supported Unix targets rename(2) replaces the destination atomically:
    // readers see either the complete v7 database or the complete v8 database.
    fs::rename(next, active).map_err(|error| {
        MigrationError::Publish(format!(
            "atomic replace {} -> {}: {error}",
            next.display(),
            active.display()
        ))
    })?;
    Ok(())
}

/// Confirm durability after the atomic publication commit point. Failure here
/// does not mean publication was rolled back: callers must surface the
/// committed-but-durability-unknown state explicitly.
pub(super) fn confirm_publication_durability(
    active: &Path,
    source_directory: &Path,
) -> MigrationResult<()> {
    sync_file(active)?;
    // rename(2) crossed from the private staging directory into the active
    // directory. Both directory updates must be durable.
    sync_directory(source_directory)?;
    sync_parent(active)
}

/// Restore a verified standalone backup without ever removing the canonical
/// active path. The backup itself remains preserved: a private restore copy is
/// fsynced and atomically replaces the published database.
pub(super) fn restore_backup_atomically(
    backup: &Path,
    active: &Path,
    restore_copy: &Path,
) -> MigrationResult<()> {
    if restore_copy.exists() {
        return Err(MigrationError::ArtifactExists(restore_copy.to_path_buf()));
    }
    fs::copy(backup, restore_copy)?;
    match_permissions(restore_copy, backup)?;
    sync_file(restore_copy)?;
    sync_parent(restore_copy)?;
    fs::rename(restore_copy, active).map_err(|error| {
        MigrationError::Publish(format!(
            "atomic restore {} -> {}: {error}",
            restore_copy.display(),
            active.display()
        ))
    })?;
    let source_directory = restore_copy.parent().ok_or_else(|| {
        MigrationError::Publish(format!("{} has no parent", restore_copy.display()))
    })?;
    confirm_publication_durability(active, source_directory)
}

/// Keep a sealed diagnostic copy without ever exposing its private contents
/// under create-default permissions.
pub(super) fn preserve_sealed_database(source: &Path, destination: &Path) -> MigrationResult<()> {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
    {
        Ok(file) => {
            drop(file);
            match_permissions(destination, source)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(MigrationError::ArtifactExists(destination.to_path_buf()));
        }
        Err(error) => return Err(error.into()),
    }
    fs::copy(source, destination)?;
    match_permissions(destination, source)?;
    sync_file(destination)?;
    sync_parent(destination)
}

/// Preserve a canonical SQLite database and any sidecars as a private group.
/// Sidecars move before the main file, so the main path remains a conservative
/// marker until the final step. The returned path points at the quarantined
/// main file and remains suitable for inspection.
pub(super) fn quarantine_database_group(
    database: &Path,
    failed_dir: &Path,
) -> MigrationResult<Option<PathBuf>> {
    let sidecars = [
        append_suffix(database, "-wal"),
        append_suffix(database, "-shm"),
    ];
    if !database.exists() && sidecars.iter().all(|path| !path.exists()) {
        return Ok(None);
    }
    if failed_dir.exists() {
        return Err(MigrationError::ArtifactExists(failed_dir.to_path_buf()));
    }
    let mut builder = DirBuilder::new();
    #[cfg(unix)]
    builder.mode(0o700);
    builder.create(failed_dir)?;

    let file_name = database.file_name().ok_or_else(|| {
        MigrationError::Publish(format!("{} has no file name", database.display()))
    })?;
    let failed_main = failed_dir.join(file_name);
    for from in sidecars {
        if from.exists() {
            let destination = failed_dir.join(from.file_name().ok_or_else(|| {
                MigrationError::Publish(format!("{} has no file name", from.display()))
            })?);
            fs::rename(from, destination)?;
        }
    }
    if database.exists() {
        fs::rename(database, &failed_main)?;
    }
    sync_directory(failed_dir)?;
    sync_parent(failed_dir)?;
    Ok(failed_main.exists().then_some(failed_main))
}

/// A run-private 0700 staging directory can be quarantined with one atomic
/// rename, keeping its database/WAL/SHM together and ensuring the basename is
/// never reused by a later attempt.
pub(super) fn quarantine_staging(
    staging_dir: &Path,
    failed_dir: &Path,
) -> MigrationResult<Option<PathBuf>> {
    if !staging_dir.exists() {
        return Ok(None);
    }
    if fs::read_dir(staging_dir)?.next().is_none() {
        fs::remove_dir(staging_dir)?;
        sync_parent(staging_dir)?;
        return Ok(None);
    }
    if failed_dir.exists() {
        return Err(MigrationError::ArtifactExists(failed_dir.to_path_buf()));
    }
    fs::rename(staging_dir, failed_dir)?;
    sync_parent(failed_dir)?;
    Ok(Some(failed_dir.to_path_buf()))
}

pub(super) fn remove_empty_staging(staging_dir: &Path) -> MigrationResult<()> {
    match fs::remove_dir(staging_dir) {
        Ok(()) => sync_parent(staging_dir),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// Remove stale `.v7.bak.<run_id>` backups left behind by earlier failed
/// migration attempts. Releases before the coverage-column probe refused to
/// start on legacy v7 tables that lacked the 0.3.15
/// `source_file_set_fingerprint` column, and every failed attempt left a fresh
/// backup behind, so affected users may hold several byte-identical backups.
///
/// Best effort and never fatal: backups modified within the last day are
/// always kept (an in-flight or recently failed attempt may still need them),
/// and among older backups the single newest one survives so a convenience
/// copy of the legacy data always remains. The active database itself is
/// untouched and stays the source of truth until the atomic publish.
pub(super) fn remove_stale_backups(active: &Path) -> MigrationResult<()> {
    let parent = active
        .parent()
        .ok_or_else(|| MigrationError::Publish(format!("{} has no parent", active.display())))?;
    let file_name = active
        .file_name()
        .ok_or_else(|| MigrationError::Publish(format!("{} has no file name", active.display())))?;
    let prefix = {
        let mut value = OsString::from(file_name);
        value.push(".v7.bak.");
        value
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let cutoff = now.checked_sub(BACKUP_GRACE_PERIOD).unwrap_or_default();
    let mut stale: Vec<(SystemTime, PathBuf)> = Vec::new();
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let name = entry.file_name();
        if !name
            .as_encoded_bytes()
            .starts_with(prefix.as_encoded_bytes())
        {
            continue;
        }
        let modified = entry.metadata()?.modified().unwrap_or(UNIX_EPOCH);
        if modified.duration_since(UNIX_EPOCH).unwrap_or_default() >= cutoff {
            continue;
        }
        stale.push((modified, entry.path()));
    }
    // Keep the newest stale backup; older ones are redundant copies.
    stale.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    for (_, path) in stale.into_iter().skip(1) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

pub(super) fn sync_file(path: &Path) -> MigrationResult<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

pub(super) fn sync_parent(path: &Path) -> MigrationResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| MigrationError::Publish(format!("{} has no parent", path.display())))?;
    sync_directory(parent)
}

fn sync_directory(path: &Path) -> MigrationResult<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

fn remove_sidecar_if_present(database: &Path, suffix: &str) -> MigrationResult<()> {
    let sidecar = append_suffix(database, suffix);
    match fs::remove_file(sidecar) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn checkpoint_to_delete(connection: &Connection, label: &str) -> MigrationResult<()> {
    let (busy, log_frames, checkpointed_frames): (i64, i64, i64) =
        connection.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
    if busy != 0 || log_frames != checkpointed_frames {
        return Err(MigrationError::Publish(format!(
            "{label} WAL checkpoint was busy (busy={busy}, log={log_frames}, checkpointed={checkpointed_frames})"
        )));
    }
    let mode: String = connection.query_row("PRAGMA journal_mode=DELETE", [], |row| row.get(0))?;
    if !mode.eq_ignore_ascii_case("delete") {
        return Err(MigrationError::Publish(format!(
            "{label} refused journal_mode=DELETE and remained {mode:?}"
        )));
    }
    Ok(())
}

pub(super) fn append_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = OsString::from(path.as_os_str());
    value.push(OsStr::new(suffix));
    PathBuf::from(value)
}

fn run_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{nanos}-{}", process::id())
}
