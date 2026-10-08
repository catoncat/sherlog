use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use rusqlite::{Connection, params};

use crate::identity::{SessionRef, SourceId};
use crate::index::{DocumentKind, IndexLayout, IndexReader, RecallOrder, RecallSpec};

use super::artifacts::append_suffix;
use super::legacy::{SourceLayout, fingerprint_v7, inspect_source_layout};
use super::{
    ColdConfigFence, FailurePoint, MigrationError, MigrationRequest, migrate_v7_to_v8,
    migrate_with_failure,
};

const HOT_ID: &str = "11111111-1111-4111-8111-111111111111";
const COLD_ID: &str = "22222222-2222-4222-8222-222222222222";

#[test]
fn copy_migration_preserves_cold_only_projection_and_imports_writer_state() {
    let fixture = Fixture::new();
    let report = migrate_v7_to_v8(&fixture.request()).unwrap();

    assert_eq!(report.session_count, 2);
    assert_eq!(report.message_count, 2);
    assert_eq!(report.document_count, 4);
    assert_eq!(report.fts_row_count, 4);
    assert_eq!(report.source_file_count, 2);
    assert_eq!(report.cold_root_count, 1);
    assert_eq!(report.coverage_rows_cleared, 1);
    assert!(report.backup_db.exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&report.backup_db)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(&fixture.db).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    assert!(matches!(
        inspect_source_layout(&report.backup_db).unwrap(),
        SourceLayout::V7
    ));
    assert_published_cold_fence(&fixture);

    let reader = IndexReader::open(&fixture.db).unwrap();
    assert_eq!(reader.layout(), IndexLayout::V8);
    assert_eq!(reader.metadata().schema_version, 8);
    assert!(reader.metadata().migration_receipt.is_some());
    assert!(reader.coverage_records(SourceId::Codex).unwrap().is_empty());

    let cold_page = reader
        .read_page(
            &SessionRef {
                source_id: SourceId::Codex,
                native_session_id: COLD_ID.to_owned(),
            },
            0,
            10,
        )
        .unwrap();
    assert_eq!(cold_page.total_count, 1);
    assert_eq!(
        cold_page.messages[0].content_text,
        "cold-only evidence 健康检查"
    );
    assert!(!fixture.cold_hot_path.exists());

    let recalled = reader
        .recall(&RecallSpec {
            terms: vec!["健康".to_owned()],
            like_needle: None,
            sources: vec![SourceId::Codex],
            session: None,
            selector: None,
            excluded_session_uuids: vec![],
            order: RecallOrder::Relevance,
            limit: 10,
        })
        .unwrap();
    assert_eq!(recalled[0].session_key, format!("codex:{COLD_ID}"));
    assert_eq!(recalled[0].kind, DocumentKind::Message);
    assert_eq!(recalled[0].body_text, "cold-only evidence 健康检查");

    let roots = reader.cold_roots(None).unwrap();
    assert_eq!(roots.len(), 1);
    assert_eq!(roots[0].source_id, SourceId::Codex);
    assert_eq!(roots[0].root, fixture.cold_root.to_str().unwrap());

    let source_files = reader
        .source_files_for_paths(
            SourceId::Codex,
            &[
                fixture.hot_file.to_str().unwrap().to_owned(),
                fixture.cold_hot_path.to_str().unwrap().to_owned(),
            ],
        )
        .unwrap();
    assert_eq!(source_files.len(), 2);
    assert!(source_files.iter().all(|file| file.mtime_ns.is_none()));
    assert!(source_files.iter().all(|file| file.indexed_bytes == 0));
    assert!(source_files.iter().all(|file| file.head_digest.is_empty()));
    assert!(
        source_files
            .iter()
            .all(|file| file.reducer_checkpoint.is_none())
    );

    let connection = Connection::open(&fixture.db).unwrap();
    let locators: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM documents WHERE raw_start IS NOT NULL OR raw_end IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(locators, 0);
    let raw_only_secret: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM documents WHERE body_text LIKE '%toolresultleakneedle%' OR \
             title_text LIKE '%toolresultleakneedle%' OR summary_text LIKE '%toolresultleakneedle%'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(raw_only_secret, 0);
}

#[test]
fn crashed_preexisting_next_is_quarantined_without_being_overwritten() {
    let fixture = Fixture::new();
    let next = append_suffix(&fixture.db, ".next");
    fs::write(&next, b"stale partial next evidence").unwrap();
    fs::write(append_suffix(&next, "-wal"), b"stale wal evidence").unwrap();
    fs::write(append_suffix(&next, "-shm"), b"stale shm evidence").unwrap();

    let report = migrate_v7_to_v8(&fixture.request()).unwrap();
    let quarantined = report.quarantined_preexisting_next.unwrap();
    assert_eq!(
        fs::read(&quarantined).unwrap(),
        b"stale partial next evidence"
    );
    let quarantine_dir = quarantined.parent().unwrap();
    assert_eq!(
        fs::read(quarantine_dir.join("index.sqlite.next-wal")).unwrap(),
        b"stale wal evidence"
    );
    assert_eq!(
        fs::read(quarantine_dir.join("index.sqlite.next-shm")).unwrap(),
        b"stale shm evidence"
    );
    assert!(!next.exists());
    assert!(!append_suffix(&next, "-wal").exists());
    assert!(!append_suffix(&next, "-shm").exists());
    assert_eq!(
        IndexReader::open(&fixture.db).unwrap().layout(),
        IndexLayout::V8
    );
}

#[test]
fn injected_mid_copy_failure_keeps_v7_active_and_quarantines_next() {
    let fixture = Fixture::new();
    let before = fingerprint_v7(&fixture.db).unwrap();
    let error =
        migrate_with_failure(&fixture.request(), Some(FailurePoint::AfterCopy)).unwrap_err();
    assert!(matches!(error, MigrationError::Injected("after_copy")));

    assert!(matches!(
        inspect_source_layout(&fixture.db).unwrap(),
        SourceLayout::V7
    ));
    assert_eq!(fingerprint_v7(&fixture.db).unwrap(), before);
    assert!(!append_suffix(&fixture.db, ".next").exists());
    assert!(!append_suffix(&fixture.db, ".sync.lock").exists());
    assert!(
        fixture
            .artifact_names()
            .iter()
            .any(|name| name.contains(".next.failed."))
    );
    assert!(
        fixture
            .artifact_names()
            .iter()
            .any(|name| name.contains(".v7.bak."))
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let failed_staging = fs::read_dir(fixture.db.parent().unwrap())
            .unwrap()
            .map(Result::unwrap)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".next.failed.")
            })
            .unwrap();
        assert!(failed_staging.file_type().unwrap().is_dir());
        assert_eq!(
            failed_staging.metadata().unwrap().permissions().mode() & 0o777,
            0o700
        );
    }

    // A failed artifact is evidence, not a poison pill: a later explicit
    // retry gets a new run id and can publish successfully.
    let report = migrate_v7_to_v8(&fixture.request()).unwrap();
    assert_eq!(report.session_count, 2);
    assert_eq!(
        IndexReader::open(&fixture.db).unwrap().layout(),
        IndexLayout::V8
    );
}

#[test]
fn injected_post_publish_failure_atomically_restores_v7_and_keeps_backup() {
    let fixture = Fixture::new();
    let before = fingerprint_v7(&fixture.db).unwrap();
    let error =
        migrate_with_failure(&fixture.request(), Some(FailurePoint::AfterPublish)).unwrap_err();
    assert!(
        matches!(error, MigrationError::Publish(detail) if detail.contains("v7 was atomically restored"))
    );

    assert!(matches!(
        inspect_source_layout(&fixture.db).unwrap(),
        SourceLayout::V7
    ));
    assert_eq!(fingerprint_v7(&fixture.db).unwrap(), before);
    let artifacts = fixture.artifact_names();
    assert!(artifacts.iter().any(|name| name.contains(".v7.bak.")));
    assert!(artifacts.iter().any(|name| name.contains(".v8.failed.")));
    assert!(!append_suffix(&fixture.db, ".sync.lock").exists());
    assert_published_cold_fence(&fixture);

    // The database rollback must not reopen the legacy writer path. A later
    // explicit migration recovers roots from the retained backup and succeeds.
    let report = migrate_v7_to_v8(&fixture.request()).unwrap();
    assert_eq!(report.cold_root_count, 1);
    assert_eq!(
        IndexReader::open(&fixture.db).unwrap().layout(),
        IndexLayout::V8
    );
}

#[test]
fn failure_after_cold_fence_keeps_v7_and_retry_recovers_backup() {
    let fixture = Fixture::new();
    let before = fingerprint_v7(&fixture.db).unwrap();
    let error =
        migrate_with_failure(&fixture.request(), Some(FailurePoint::AfterColdFence)).unwrap_err();
    assert!(matches!(
        error,
        MigrationError::Injected("after_cold_fence")
    ));
    assert!(matches!(
        inspect_source_layout(&fixture.db).unwrap(),
        SourceLayout::V7
    ));
    assert_eq!(fingerprint_v7(&fixture.db).unwrap(), before);
    assert_published_cold_fence(&fixture);

    let report = migrate_v7_to_v8(&fixture.request()).unwrap();
    assert_eq!(report.cold_root_count, 1);
    assert_eq!(
        IndexReader::open(&fixture.db).unwrap().layout(),
        IndexLayout::V8
    );
}

#[test]
fn missing_cold_config_is_fenced_without_inventing_roots() {
    let fixture = Fixture::new();
    fs::remove_file(&fixture.config).unwrap();

    let report = migrate_v7_to_v8(&fixture.request()).unwrap();
    assert_eq!(report.cold_root_count, 0);
    let fence = ColdConfigFence::inspect(&fixture.config).unwrap();
    assert!(fence.is_published());
    assert!(fence.snapshot_bytes().is_none());
    assert!(fence.recovery_backup_path().is_none());
    assert!(fence.cold_roots(&fixture.cwd).unwrap().is_empty());
    assert!(fs::write(&fixture.config, b"must not replace fence").is_err());
}

#[test]
fn missing_config_race_fails_instead_of_overwriting_new_roots() {
    let fixture = Fixture::new();
    fs::remove_file(&fixture.config).unwrap();
    let mut fence = ColdConfigFence::inspect(&fixture.config).unwrap();
    fence.preflight().unwrap();
    let concurrent = b"{\"version\":1,\"roots\":[]}\n";
    fs::write(&fixture.config, concurrent).unwrap();

    let error = fence.publish().unwrap_err();
    assert!(matches!(error, MigrationError::ColdConfig(_)));
    assert_eq!(fs::read(&fixture.config).unwrap(), concurrent);
    assert!(
        fs::symlink_metadata(&fixture.config)
            .unwrap()
            .file_type()
            .is_file()
    );
}

#[test]
fn same_bytes_inode_replacement_is_rejected_before_fence_publish() {
    let fixture = Fixture::new();
    let mut fence = ColdConfigFence::inspect(&fixture.config).unwrap();
    fence.preflight().unwrap();
    let bytes = fs::read(&fixture.config).unwrap();
    let replacement = fixture.config.with_extension("replacement");
    fs::write(&replacement, &bytes).unwrap();
    fs::rename(&replacement, &fixture.config).unwrap();

    let error = fence.publish().unwrap_err();
    assert!(matches!(error, MigrationError::ColdConfig(_)));
    assert_eq!(fs::read(&fixture.config).unwrap(), bytes);
    assert!(
        fs::symlink_metadata(&fixture.config)
            .unwrap()
            .file_type()
            .is_file()
    );
}

#[test]
fn same_bytes_inode_replacement_between_inspect_and_preflight_is_rejected() {
    let fixture = Fixture::new();
    let mut fence = ColdConfigFence::inspect(&fixture.config).unwrap();
    let bytes = fs::read(&fixture.config).unwrap();
    let replacement = fixture.config.with_extension("preflight-replacement");
    fs::write(&replacement, &bytes).unwrap();
    fs::rename(&replacement, &fixture.config).unwrap();

    let error = fence.preflight().unwrap_err();
    assert!(matches!(error, MigrationError::ColdConfig(_)));
    assert!(
        fs::symlink_metadata(&fixture.config)
            .unwrap()
            .file_type()
            .is_file()
    );
}

#[cfg(unix)]
#[test]
fn late_legacy_file_descriptor_changes_backup_and_is_recovered_on_retry() {
    let fixture = Fixture::new();
    let mut legacy_fd = fs::OpenOptions::new()
        .write(true)
        .open(&fixture.config)
        .unwrap();
    let mut fence = ColdConfigFence::inspect(&fixture.config).unwrap();
    fence.preflight().unwrap();
    fence.publish().unwrap();

    let updated = b"{\"version\":1,\"roots\":[]}\n";
    legacy_fd.set_len(0).unwrap();
    legacy_fd.seek(SeekFrom::Start(0)).unwrap();
    legacy_fd.write_all(updated).unwrap();
    legacy_fd.sync_all().unwrap();
    assert!(matches!(
        fence.complete(),
        Err(MigrationError::ColdConfig(_))
    ));

    let recovered = ColdConfigFence::inspect(&fixture.config).unwrap();
    assert!(recovered.is_published());
    assert_eq!(recovered.snapshot_bytes(), Some(updated.as_slice()));
    assert!(recovered.cold_roots(&fixture.cwd).unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn unrelated_symlink_is_not_accepted_as_an_owned_fence() {
    use std::os::unix::fs::symlink;

    let fixture = Fixture::new();
    fs::remove_file(&fixture.config).unwrap();
    let unrelated = fixture.config.parent().unwrap().join("unrelated");
    fs::create_dir(&unrelated).unwrap();
    symlink("unrelated", &fixture.config).unwrap();

    assert!(matches!(
        ColdConfigFence::inspect(&fixture.config),
        Err(MigrationError::ColdConfig(_))
    ));
}

#[test]
fn opening_v7_read_only_never_creates_migration_artifacts() {
    let fixture = Fixture::new();
    let before = fingerprint_v7(&fixture.db).unwrap();
    let reader = IndexReader::open(&fixture.db).unwrap();
    assert_eq!(reader.layout(), IndexLayout::V7);
    drop(reader);
    assert_eq!(fingerprint_v7(&fixture.db).unwrap(), before);
    assert!(!append_suffix(&fixture.db, ".next").exists());
    assert!(
        !fixture
            .artifact_names()
            .iter()
            .any(|name| name.contains(".v7.bak."))
    );
}

#[test]
fn existing_legacy_writer_lock_blocks_without_touching_v7() {
    let fixture = Fixture::new();
    let before = fingerprint_v7(&fixture.db).unwrap();
    let lock = append_suffix(&fixture.db, ".sync.lock");
    fs::create_dir(&lock).unwrap();
    let pid = std::process::id();
    fs::write(
        lock.join(format!("{pid}-0.json")),
        format!(r#"{{"pid":{pid},"createdAt":"2026-08-15T00:00:00Z"}}"#),
    )
    .unwrap();

    let error = migrate_v7_to_v8(&fixture.request()).unwrap_err();
    assert!(matches!(error, MigrationError::LockBusy(path) if path == lock));
    assert_eq!(fingerprint_v7(&fixture.db).unwrap(), before);
    assert!(!append_suffix(&fixture.db, ".next").exists());
}

#[test]
fn crashed_complete_migration_lock_is_reclaimed_on_retry() {
    let fixture = Fixture::new();
    let lock = append_suffix(&fixture.db, ".sync.lock");
    fs::write(
        &lock,
        r#"{"pid":4294967295,"createdAt":"2026-08-15T00:00:00Z"}"#,
    )
    .unwrap();

    let report = migrate_v7_to_v8(&fixture.request()).unwrap();
    assert_eq!(report.session_count, 2);
    assert!(!lock.exists());
    assert_eq!(
        IndexReader::open(&fixture.db).unwrap().layout(),
        IndexLayout::V8
    );
}

#[test]
fn malformed_existing_cold_config_fails_closed_before_copy() {
    let fixture = Fixture::new();
    let before = fingerprint_v7(&fixture.db).unwrap();
    fs::write(&fixture.config, b"{not-json").unwrap();

    let error = migrate_v7_to_v8(&fixture.request()).unwrap_err();
    assert!(matches!(error, MigrationError::ColdConfig(_)));
    assert_eq!(fingerprint_v7(&fixture.db).unwrap(), before);
    assert!(matches!(
        inspect_source_layout(&fixture.db).unwrap(),
        SourceLayout::V7
    ));
    assert!(
        !fixture
            .artifact_names()
            .iter()
            .any(|name| name.contains(".v7.bak."))
    );
}

#[test]
fn orphaned_v7_message_is_rejected_in_preflight() {
    let fixture = Fixture::new();
    let connection = Connection::open(&fixture.db).unwrap();
    connection
        .pragma_update(None, "foreign_keys", "OFF")
        .unwrap();
    connection
        .execute(
            "INSERT INTO messages(session_id, session_uuid, seq, role, content_text, timestamp, source_kind) \
             VALUES (999999, 'orphan', 0, 'user', 'must not disappear', \
                     '2026-08-15T00:00:00.000Z', 'event_msg')",
            [],
        )
        .unwrap();
    drop(connection);

    let error = migrate_v7_to_v8(&fixture.request()).unwrap_err();
    assert!(
        matches!(error, MigrationError::InvalidV7(detail) if detail.contains("foreign_key_check") || detail.contains("orphaned messages"))
    );
    assert!(matches!(
        inspect_source_layout(&fixture.db).unwrap(),
        SourceLayout::V7
    ));
    let connection = Connection::open(&fixture.db).unwrap();
    let orphan_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE session_id=999999",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(orphan_count, 1);
}

fn assert_published_cold_fence(fixture: &Fixture) {
    let metadata = fs::symlink_metadata(&fixture.config).unwrap();
    assert!(metadata.file_type().is_symlink());
    let fence = ColdConfigFence::inspect(&fixture.config).unwrap();
    assert!(fence.is_published());
    assert_eq!(fence.cold_roots(&fixture.cwd).unwrap().len(), 1);
    let backup = fence.recovery_backup_path().unwrap();
    assert!(backup.is_file());
    let bytes = fs::read(&backup).unwrap();
    assert!(
        String::from_utf8(bytes)
            .unwrap()
            .contains(fixture.cold_root.to_str().unwrap())
    );
    assert!(fs::write(&fixture.config, b"old writer must fail").is_err());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let target = fs::read_link(&fixture.config).unwrap();
        assert_eq!(target.components().count(), 1);
        let state = fixture.config.parent().unwrap().join(target);
        assert!(state.is_dir());
        assert_eq!(
            fs::metadata(state).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
}

/// Regression for the 0.5.0/0.5.1 migration incident: old JavaScript writers
/// could persist lone UTF-16 surrogates into TEXT columns (invalid UTF-8
/// bytes). The import path must normalize them lossily instead of failing the
/// whole migration on one drifted cell.
#[test]
fn migration_tolerates_legacy_lone_surrogate_text() {
    let fixture = Fixture::new();
    let connection = Connection::open(&fixture.db).unwrap();
    // 0xED 0xA0 0xBD is the UTF-8 encoding of the lone high surrogate U+D83D.
    connection
        .execute(
            "UPDATE sessions SET title = CAST(x'6c6f6e6520eda0bd737572' AS TEXT) WHERE native_session_id=?",
            [HOT_ID],
        )
        .unwrap();
    drop(connection);

    let report = migrate_v7_to_v8(&fixture.request()).unwrap();
    assert_eq!(report.session_count, 2);
    let reader = IndexReader::open(&fixture.db).unwrap();
    assert_eq!(reader.layout(), IndexLayout::V8);
    let hot = reader
        .load_session(&SessionRef {
            source_id: SourceId::Codex,
            native_session_id: HOT_ID.to_owned(),
        })
        .unwrap()
        .unwrap();
    assert!(hot.title.contains('\u{FFFD}'), "title: {:?}", hot.title);
    assert!(hot.title.contains("lone"));
}

/// Regression for the 0.5.0 v7-read incident: legacy TS schema versions
/// stored `raw_file_mtime` with REAL storage class. The migration import path
/// must accept any numeric storage class and normalize it.
#[test]
fn migration_tolerates_legacy_real_raw_file_mtime() {
    let fixture = Fixture::new();
    let connection = Connection::open(&fixture.db).unwrap();
    // +0.5 cannot be represented losslessly under INTEGER affinity, so SQLite
    // stores the column values with REAL storage class, like old TS writes.
    connection
        .execute(
            "UPDATE sessions SET raw_file_mtime = raw_file_mtime + 0.5",
            [],
        )
        .unwrap();
    let real_rows = connection
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE typeof(raw_file_mtime)='real'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap();
    assert_eq!(real_rows, 2);
    drop(connection);

    let report = migrate_v7_to_v8(&fixture.request()).unwrap();
    assert_eq!(report.session_count, 2);
    let reader = IndexReader::open(&fixture.db).unwrap();
    assert_eq!(reader.layout(), IndexLayout::V8);
    assert_eq!(reader.stats(SourceId::Codex).unwrap().session_count, 2);
}

struct Fixture {
    _temp: tempfile::TempDir,
    db: PathBuf,
    config: PathBuf,
    cwd: PathBuf,
    hot_file: PathBuf,
    cold_hot_path: PathBuf,
    cold_root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().to_path_buf();
        let state = temp.path().join("state");
        let hot_root = temp.path().join("hot");
        let cold_root = temp.path().join("cold");
        fs::create_dir_all(&state).unwrap();
        fs::create_dir_all(&hot_root).unwrap();
        fs::create_dir_all(&cold_root).unwrap();
        let db = state.join("index.sqlite");
        let config = state.join("cold-roots.json");
        let hot_file = hot_root.join(format!("rollout-hot-{HOT_ID}.jsonl"));
        let cold_hot_path = hot_root.join(format!("rollout-old-{COLD_ID}.jsonl"));
        fs::write(
            &hot_file,
            "raw tool result toolresultleakneedle must never be projected\n",
        )
        .unwrap();
        fs::write(
            cold_root.join(format!("rollout-archived-{COLD_ID}.jsonl.zst")),
            b"compressed raw toolresultleakneedle is presence-only and must not be parsed",
        )
        .unwrap();
        fs::write(
            &config,
            format!(
                "{{\"version\":1,\"roots\":[{{\"sourceId\":\"codex\",\"root\":{},\"addedAt\":\"2026-08-15T00:00:00.000Z\"}}]}}\n",
                serde_json::to_string(cold_root.to_str().unwrap()).unwrap()
            ),
        )
        .unwrap();
        create_v7(&db, &hot_file, &cold_hot_path);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&db, fs::Permissions::from_mode(0o600)).unwrap();
        }
        Self {
            _temp: temp,
            db,
            config,
            cwd,
            hot_file,
            cold_hot_path,
            cold_root,
        }
    }

    fn request(&self) -> MigrationRequest {
        MigrationRequest::for_database(&self.db, &self.cwd).with_cold_roots_config(&self.config)
    }

    fn artifact_names(&self) -> Vec<String> {
        fs::read_dir(self.db.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect()
    }
}

fn drop_coverage_set_fingerprint_column(connection: &Connection) {
    // Rebuild the coverage table exactly as 0.4.3 and earlier wrote it: no
    // `source_file_set_fingerprint` column, same 13 remaining columns.
    connection
        .execute_batch(
            "CREATE TABLE coverage_legacy (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               source_id TEXT NOT NULL DEFAULT 'codex',
               selector_key TEXT NOT NULL UNIQUE,
               selector_json TEXT NOT NULL,
               selector_kind TEXT NOT NULL,
               root TEXT NOT NULL,
               cwd TEXT,
               from_date TEXT,
               to_date TEXT,
               source_fingerprint TEXT NOT NULL,
               source_file_count INTEGER NOT NULL,
               indexed_session_count INTEGER NOT NULL,
               completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               index_version TEXT NOT NULL
             );
             INSERT INTO coverage_legacy(
               source_id, selector_key, selector_json, selector_kind, root,
               source_fingerprint, source_file_count, indexed_session_count,
               index_version
             )
             SELECT source_id, selector_key, selector_json, selector_kind, root,
                    source_fingerprint, source_file_count, indexed_session_count,
                    index_version
             FROM coverage;
             DROP TABLE coverage;
             ALTER TABLE coverage_legacy RENAME TO coverage;",
        )
        .unwrap();
}

fn set_file_mtime(path: &Path, time: SystemTime) {
    let file = fs::File::options().write(true).open(path).unwrap();
    file.set_times(std::fs::FileTimes::new().set_modified(time))
        .unwrap();
}

#[test]
fn migration_accepts_legacy_v7_without_source_file_set_fingerprint() {
    let fixture = Fixture::new();
    let connection = Connection::open(&fixture.db).unwrap();
    drop_coverage_set_fingerprint_column(&connection);
    connection.close().unwrap();

    let report = migrate_v7_to_v8(&fixture.request()).unwrap();

    assert_eq!(report.session_count, 2);
    assert_eq!(report.message_count, 2);
    assert_eq!(report.coverage_rows_cleared, 1);
    let reader = IndexReader::open(&fixture.db).unwrap();
    assert_eq!(reader.layout(), IndexLayout::V8);
    assert_eq!(reader.stats(SourceId::Codex).unwrap().session_count, 2);
}

#[test]
fn v7_fingerprint_distinguishes_missing_and_null_set_fingerprint_columns() {
    let temp = tempfile::tempdir().unwrap();
    let nullable = temp.path().join("nullable-v7.sqlite");
    let missing = temp.path().join("missing-v7.sqlite");
    for (path, with_column) in [(&nullable, true), (&missing, false)] {
        let connection = Connection::open(path).unwrap();
        create_v7(
            path,
            Path::new("/tmp/fingerprint-hot.jsonl"),
            Path::new("/tmp/fingerprint-cold.jsonl"),
        );
        if with_column {
            // The fixture column is NOT NULL, so rebuild it nullable and store
            // explicit NULLs. Only the marker mixed into the digest can then
            // tell the two schema shapes apart.
            connection
                .execute_batch(
                    "CREATE TABLE coverage_nullable (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       source_id TEXT NOT NULL DEFAULT 'codex',
                       selector_key TEXT NOT NULL UNIQUE,
                       selector_json TEXT NOT NULL,
                       selector_kind TEXT NOT NULL,
                       root TEXT NOT NULL,
                       cwd TEXT,
                       from_date TEXT,
                       to_date TEXT,
                       source_fingerprint TEXT NOT NULL,
                       source_file_set_fingerprint TEXT,
                       source_file_count INTEGER NOT NULL,
                       indexed_session_count INTEGER NOT NULL,
                       completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                       index_version TEXT NOT NULL
                     );
                     INSERT INTO coverage_nullable(
                       source_id, selector_key, selector_json, selector_kind, root,
                       source_fingerprint, source_file_count, indexed_session_count,
                       index_version
                     )
                     SELECT source_id, selector_key, selector_json, selector_kind, root,
                            source_fingerprint, source_file_count, indexed_session_count,
                            index_version
                     FROM coverage;
                     DROP TABLE coverage;
                     ALTER TABLE coverage_nullable RENAME TO coverage;
                     UPDATE coverage SET source_file_set_fingerprint = NULL;",
                )
                .unwrap();
        } else {
            drop_coverage_set_fingerprint_column(&connection);
        }
        connection.close().unwrap();
    }

    let nullable = fingerprint_v7(&nullable).unwrap();
    let missing = fingerprint_v7(&missing).unwrap();

    assert_eq!(nullable.session_count, missing.session_count);
    assert_eq!(nullable.coverage_count, missing.coverage_count);
    assert_ne!(nullable.digest, missing.digest);
}

#[test]
fn migration_cleans_stale_backups_from_earlier_failed_attempts() {
    let fixture = Fixture::new();
    let old_backup = append_suffix(&fixture.db, ".v7.bak.1111111111111111111-1");
    let newer_backup = append_suffix(&fixture.db, ".v7.bak.2222222222222222222-2");
    fs::write(&old_backup, b"older stale backup").unwrap();
    fs::write(&newer_backup, b"newer stale backup").unwrap();
    // Both timestamps are far enough in the past to be outside the cleanup
    // grace period; the newest one must survive as the retained copy.
    set_file_mtime(
        &old_backup,
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000),
    );
    set_file_mtime(
        &newer_backup,
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_750_000_000),
    );

    let report = migrate_v7_to_v8(&fixture.request()).unwrap();

    assert_eq!(report.session_count, 2);
    assert_eq!(
        IndexReader::open(&fixture.db).unwrap().layout(),
        IndexLayout::V8
    );
    assert!(!old_backup.exists());
    assert!(newer_backup.exists());
    assert_eq!(fs::read(&newer_backup).unwrap(), b"newer stale backup");
    assert!(report.backup_db.exists());
}

#[test]
fn migration_still_accepts_current_v7_with_source_file_set_fingerprint() {
    let fixture = Fixture::new();

    let report = migrate_v7_to_v8(&fixture.request()).unwrap();

    assert_eq!(report.session_count, 2);
    assert_eq!(report.coverage_rows_cleared, 1);
    assert_eq!(
        IndexReader::open(&fixture.db).unwrap().layout(),
        IndexLayout::V8
    );
}

fn create_v7(db_path: &Path, hot_file: &Path, cold_hot_path: &Path) {
    let connection = Connection::open(db_path).unwrap();
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .unwrap();
    connection
        .execute_batch(
            "CREATE TABLE sessions (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               source_id TEXT NOT NULL DEFAULT 'codex',
               native_session_id TEXT NOT NULL DEFAULT '',
               session_key TEXT NOT NULL UNIQUE,
               session_uuid TEXT NOT NULL,
               file_path TEXT NOT NULL,
               source_root TEXT NOT NULL DEFAULT '',
               title TEXT NOT NULL DEFAULT '',
               summary_text TEXT NOT NULL DEFAULT '',
               compact_text TEXT NOT NULL DEFAULT '',
               reasoning_summary_text TEXT NOT NULL DEFAULT '',
               cwd TEXT NOT NULL DEFAULT '',
               model TEXT NOT NULL DEFAULT '',
               started_at TEXT NOT NULL,
               ended_at TEXT NOT NULL,
               path_date TEXT NOT NULL DEFAULT '',
               message_count INTEGER NOT NULL DEFAULT 0,
               raw_file_mtime INTEGER NOT NULL DEFAULT 0,
               raw_file_size INTEGER NOT NULL DEFAULT 0,
               index_version TEXT NOT NULL DEFAULT '',
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               UNIQUE(source_id, native_session_id),
               UNIQUE(source_id, file_path)
             );
             CREATE TABLE messages (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
               session_uuid TEXT NOT NULL,
               seq INTEGER NOT NULL,
               role TEXT NOT NULL,
               content_text TEXT NOT NULL,
               timestamp TEXT NOT NULL,
               source_kind TEXT NOT NULL,
               UNIQUE(session_id, seq)
             );
             CREATE TABLE source_file_meta_cache (
               source_id TEXT NOT NULL,
               file_path TEXT NOT NULL,
               mtime_ms REAL NOT NULL,
               size INTEGER NOT NULL,
               cwd TEXT NOT NULL DEFAULT '',
               path_date TEXT,
               extra_fingerprint TEXT NOT NULL DEFAULT '',
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY(source_id, file_path)
             );
             CREATE TABLE coverage (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               source_id TEXT NOT NULL DEFAULT 'codex',
               selector_key TEXT NOT NULL UNIQUE,
               selector_json TEXT NOT NULL,
               selector_kind TEXT NOT NULL,
               root TEXT NOT NULL,
               cwd TEXT,
               from_date TEXT,
               to_date TEXT,
               source_fingerprint TEXT NOT NULL,
               source_file_set_fingerprint TEXT NOT NULL DEFAULT '',
               source_file_count INTEGER NOT NULL,
               indexed_session_count INTEGER NOT NULL,
               completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               index_version TEXT NOT NULL
             );",
        )
        .unwrap();

    insert_session(
        &connection,
        HOT_ID,
        hot_file,
        "Hot session",
        "hot searchable evidence",
        "2026-08-14T10:00:00.000Z",
    );
    insert_session(
        &connection,
        COLD_ID,
        cold_hot_path,
        "Cold-only session",
        "cold-only evidence 健康检查",
        "2026-08-13T10:00:00.000Z",
    );
    connection
        .execute(
            "INSERT INTO coverage(
               source_id, selector_key, selector_json, selector_kind, root,
               source_fingerprint, source_file_set_fingerprint, source_file_count,
               indexed_session_count, index_version
             ) VALUES ('codex', 'old-selector', '{\"source\":\"codex\",\"kind\":\"all\",\"root\":\"/tmp\"}',
                       'all', '/tmp', 'old-content', 'old-set', 2, 2,
                       'shlog-v7-source-identity')",
            [],
        )
        .unwrap();
}

fn insert_session(
    connection: &Connection,
    native_id: &str,
    file_path: &Path,
    title: &str,
    message: &str,
    timestamp: &str,
) {
    connection
        .execute(
            "INSERT INTO sessions(
               source_id, native_session_id, session_key, session_uuid, file_path, source_root,
               title, summary_text, compact_text, reasoning_summary_text, cwd, model,
               started_at, ended_at, path_date, message_count, raw_file_mtime,
               raw_file_size, index_version
             ) VALUES ('codex', ?, ?, ?, ?, ?, ?, ?, 'compact', 'reasoning', '/work',
                       'gpt-5', ?, ?, '2026-08-14', 1, 1234, 99,
                       'shlog-v7-source-identity')",
            params![
                native_id,
                format!("codex:{native_id}"),
                native_id,
                file_path.to_str().unwrap(),
                file_path.parent().unwrap().to_str().unwrap(),
                title,
                format!("summary for {title}"),
                timestamp,
                timestamp,
            ],
        )
        .unwrap();
    let session_id = connection.last_insert_rowid();
    connection
        .execute(
            "INSERT INTO messages(session_id, session_uuid, seq, role, content_text, timestamp, source_kind)
             VALUES (?, ?, 0, 'user', ?, ?, 'event_msg')",
            params![session_id, native_id, message, timestamp],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO source_file_meta_cache(
               source_id, file_path, mtime_ms, size, cwd, path_date, extra_fingerprint
             ) VALUES ('codex', ?, 1234.5, 99, '/work', '2026-08-14', 'accepted')",
            [file_path.to_str().unwrap()],
        )
        .unwrap();
}
