use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};

use crate::identity::SourceId;
use crate::index::IndexReader;
use crate::selector::Selector;
use crate::sources::inject_metadata_failure;
use rusqlite::Connection;
use tempfile::tempdir;

use super::*;

fn selector(root: &Path) -> Selector {
    Selector::All {
        source: SourceId::Codex,
        root: root.to_string_lossy().into_owned(),
    }
}

#[derive(Default)]
struct RecordingCutover {
    phases: Vec<&'static str>,
    fail_publish: bool,
    fail_complete: bool,
}

impl LegacyCutover for RecordingCutover {
    fn preflight(&mut self) -> Result<(), String> {
        self.phases.push("preflight");
        Ok(())
    }

    fn publish(&mut self) -> Result<(), String> {
        self.phases.push("publish");
        if self.fail_publish {
            Err("injected fence failure".to_owned())
        } else {
            Ok(())
        }
    }

    fn complete(&mut self) -> Result<(), String> {
        self.phases.push("complete");
        if self.fail_complete {
            Err("injected confirmation failure".to_owned())
        } else {
            Ok(())
        }
    }
}

fn write_session(path: &Path, id: &str, cwd: &str, messages: &[(&str, &str)]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut lines = vec![
        serde_json::json!({
            "timestamp":"2026-08-15T00:00:00Z",
            "type":"session_meta",
            "payload":{"id":id,"cwd":cwd}
        })
        .to_string(),
    ];
    for (index, (kind, message)) in messages.iter().enumerate() {
        lines.push(
            serde_json::json!({
                "timestamp":format!("2026-08-15T00:00:{:02}Z", index + 1),
                "type":"event_msg",
                "payload":{"type":kind,"message":message}
            })
            .to_string(),
        );
    }
    fs::write(path, format!("{}\n", lines.join("\n"))).unwrap();
}

fn append_message(path: &Path, kind: &str, message: &str, second: u64) {
    let mut file = OpenOptions::new().append(true).open(path).unwrap();
    writeln!(
        file,
        "{}",
        serde_json::json!({
            "timestamp":format!("2026-08-15T00:00:{second:02}Z"),
            "type":"event_msg",
            "payload":{"type":kind,"message":message}
        })
    )
    .unwrap();
}

fn response_line(role: &str, text: &str, second: u64) -> serde_json::Value {
    serde_json::json!({
        "timestamp":format!("2026-08-15T00:00:{second:02}Z"),
        "type":"response_item",
        "payload":{"type":"message","role":role,"content":[{
            "type":if role == "user" { "input_text" } else { "output_text" },
            "text":text
        }]}
    })
}

fn append_response(path: &Path, role: &str, text: &str, second: u64) {
    let mut file = OpenOptions::new().append(true).open(path).unwrap();
    writeln!(file, "{}", response_line(role, text, second)).unwrap();
}

fn append_private_call(path: &Path, argument: &str, second: u64) {
    let mut file = OpenOptions::new().append(true).open(path).unwrap();
    writeln!(
        file,
        "{}",
        serde_json::json!({
            "timestamp":format!("2026-08-15T00:00:{second:02}Z"),
            "type":"response_item",
            "payload":{"type":"function_call","name":"shell","arguments":argument}
        })
    )
    .unwrap();
}

fn projection_view(
    db: &Path,
    id: &str,
) -> (
    crate::model::SessionRecord,
    Vec<crate::model::MessageRecord>,
) {
    let page = IndexReader::open(db)
        .unwrap()
        .read_page(&crate::identity::parse_session_ref(id), 0, 100)
        .unwrap();
    (page.session, page.messages)
}

fn assert_cold_prune_fails_closed(db: &Path, root: &Path, id: &str) {
    for best_effort in [false, true] {
        let mut request = SyncRequest::new(db, selector(root));
        request.prune = true;
        request.best_effort = best_effort;
        let failure = run(request).unwrap_err();
        assert!(failure.report.error_details.iter().any(|detail| {
            detail.file_path == "(cold roots)" && detail.message.contains("inspect cold root")
        }));
        assert_eq!(projection_view(db, id).1.len(), 1);
    }
}

fn document_row_ids(db: &Path, table: &str) -> Vec<i64> {
    let connection = Connection::open(db).unwrap();
    let sql = format!("SELECT rowid FROM {table} ORDER BY rowid");
    let mut statement = connection.prepare(&sql).unwrap();
    statement
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

#[test]
fn full_noop_append_and_truncate_use_safe_paths() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let day = root.join("2026/08/15");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let path = day.join(format!("rollout-2026-08-15T00-00-00-{id}.jsonl"));
    write_session(&path, id, "/work", &[("user_message", "initial evidence")]);
    let db = temp.path().join("index.sqlite");

    let first = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!((first.added, first.updated, first.skipped), (1, 0, 0));
    assert!(first.coverage.written);

    let noop_request = SyncRequest::new(&db, selector(&root));
    let existing = load_existing_state(&noop_request).unwrap();
    let scan = SourceCatalog
        .scan(
            &noop_request.selector,
            &metadata_cache(&existing.source_files),
        )
        .unwrap();
    let selected = selected_files(&scan);
    assert_eq!(existing.source_files.len(), 1);
    assert_eq!(selected.len(), 1);
    assert!(
        source_file_unchanged(&existing.source_files[0], &selected[0]),
        "stored={:?}\nraw={:?}",
        existing.source_files[0],
        selected[0]
    );
    assert_eq!(
        existing.source_files[0].mtime_ns.map(i128::from),
        Some(selected[0].mtime_ns)
    );
    let mut drifted = existing.source_files[0].clone();
    drifted.mtime_ms = selected[0].mtime_ms + 0.000_2;
    assert!(source_file_unchanged(&drifted, &selected[0]));
    drifted.mtime_ns = drifted.mtime_ns.map(|value| value + 1);
    assert!(!source_file_unchanged(&drifted, &selected[0]));
    drifted.mtime_ns = None;
    assert!(!source_file_unchanged(&drifted, &selected[0]));

    // A valid exact-time + checkpoint-identity cache entry avoids reopening
    // source metadata. The injected adapter failure would surface on a miss.
    {
        let _injection = inject_metadata_failure(&path);
        let cached = SourceCatalog
            .scan(
                &noop_request.selector,
                &metadata_cache(&existing.source_files),
            )
            .unwrap();
        assert!(cached.failures.is_empty());
        assert_eq!(cached.files.len(), 1);
    }
    {
        let mut stale_states = existing.source_files.clone();
        stale_states[0].coverage_epoch = COVERAGE_EPOCH - 1;
        let _injection = inject_metadata_failure(&path);
        let stale = SourceCatalog
            .scan(&noop_request.selector, &metadata_cache(&stale_states))
            .unwrap();
        assert_eq!(stale.failures.len(), 1);
    }

    let noop = run(noop_request).unwrap();
    assert_eq!((noop.added, noop.updated, noop.skipped), (0, 0, 1));
    assert!(noop.coverage.written);

    append_message(&path, "agent_message", "append evidence", 2);
    let appended = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!((appended.added, appended.updated), (0, 1));
    let reader = IndexReader::open(&db).unwrap();
    let page = reader
        .read_page(&crate::identity::parse_session_ref(id), 0, 10)
        .unwrap();
    assert_eq!(page.total_count, 2);
    assert_eq!(page.messages[1].content_text, "append evidence");
    drop(reader);

    // A cursor beyond the truncated file forces a full projection and atomic
    // replacement; stale append evidence must disappear.
    write_session(&path, id, "/work", &[("user_message", "replacement")]);
    let truncated = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!(truncated.updated, 1);
    let reader = IndexReader::open(&db).unwrap();
    let page = reader
        .read_page(&crate::identity::parse_session_ref(id), 0, 10)
        .unwrap();
    assert_eq!(page.total_count, 1);
    assert_eq!(page.messages[0].content_text, "replacement");
}

#[test]
fn byte_identical_replacement_refreshes_cursor_without_replacing_documents() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let day = root.join("2026/08/15");
    let id = "abababab-abab-4bab-8bab-abababababab";
    let path = day.join(format!("rollout-2026-08-15T00-00-00-{id}.jsonl"));
    write_session(
        &path,
        id,
        "/work",
        &[("user_message", "identity refresh evidence")],
    );
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();

    let documents_before = document_row_ids(&db, "documents");
    let fts_before = document_row_ids(&db, "documents_fts");
    let prior = load_existing_state(&SyncRequest::new(&db, selector(&root))).unwrap();
    let prior_checkpoint = persisted_checkpoint(&prior.source_files[0]).unwrap();

    let replacement = path.with_extension("replacement");
    fs::copy(&path, &replacement).unwrap();
    fs::remove_file(&path).unwrap();
    fs::rename(&replacement, &path).unwrap();

    let refreshed = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!(
        (refreshed.added, refreshed.updated, refreshed.skipped),
        (0, 0, 1)
    );
    assert_eq!(document_row_ids(&db, "documents"), documents_before);
    assert_eq!(document_row_ids(&db, "documents_fts"), fts_before);
    assert_eq!(
        projection_view(&db, id).1[0].content_text,
        "identity refresh evidence"
    );

    let refreshed_state = load_existing_state(&SyncRequest::new(&db, selector(&root))).unwrap();
    let refreshed_checkpoint = persisted_checkpoint(&refreshed_state.source_files[0]).unwrap();
    #[cfg(unix)]
    assert_ne!(
        refreshed_checkpoint.file_identity,
        prior_checkpoint.file_identity
    );

    // A second run must use the refreshed exact identity/mtime cache entry.
    // The injected metadata failure would make the sync fail on another miss.
    let _injection = inject_metadata_failure(&path);
    let noop = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!((noop.added, noop.updated, noop.skipped), (0, 0, 1));
}

#[test]
fn incremental_append_rewrite_and_truncate_equal_fresh_full_replay() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let day = root.join("2026/08/15");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let path = day.join(format!("rollout-2026-08-15T00-00-00-{id}.jsonl"));
    write_session(&path, id, "/work", &[("user_message", "first evidence")]);
    let incremental_db = temp.path().join("incremental.sqlite");
    run(SyncRequest::new(&incremental_db, selector(&root))).unwrap();

    append_message(&path, "agent_message", "appended answer", 2);
    run(SyncRequest::new(&incremental_db, selector(&root))).unwrap();
    let append_full_db = temp.path().join("append-full.sqlite");
    run(SyncRequest::new(&append_full_db, selector(&root))).unwrap();
    assert_eq!(
        projection_view(&incremental_db, id),
        projection_view(&append_full_db, id)
    );

    let before = fs::read_to_string(&path).unwrap();
    let rewritten = before.replace("first evidence", "frost evidence");
    assert_eq!(rewritten.len(), before.len());
    fs::write(&path, rewritten).unwrap();
    run(SyncRequest::new(&incremental_db, selector(&root))).unwrap();
    let rewrite_full_db = temp.path().join("rewrite-full.sqlite");
    run(SyncRequest::new(&rewrite_full_db, selector(&root))).unwrap();
    assert_eq!(
        projection_view(&incremental_db, id),
        projection_view(&rewrite_full_db, id)
    );

    write_session(&path, id, "/work", &[("user_message", "short replacement")]);
    run(SyncRequest::new(&incremental_db, selector(&root))).unwrap();
    let truncate_full_db = temp.path().join("truncate-full.sqlite");
    run(SyncRequest::new(&truncate_full_db, selector(&root))).unwrap();
    assert_eq!(
        projection_view(&incremental_db, id),
        projection_view(&truncate_full_db, id)
    );
}

#[test]
fn rename_with_explicit_prune_equals_fresh_full_replay() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let day = root.join("2026/08/15");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let original = day.join(format!("rollout-original-{id}.jsonl"));
    let renamed = day.join(format!("rollout-renamed-{id}.jsonl"));
    write_session(
        &original,
        id,
        "/work",
        &[("user_message", "rename evidence")],
    );
    let incremental_db = temp.path().join("incremental.sqlite");
    run(SyncRequest::new(&incremental_db, selector(&root))).unwrap();

    fs::rename(&original, &renamed).unwrap();
    let mut request = SyncRequest::new(&incremental_db, selector(&root));
    request.prune = true;
    run(request).unwrap();
    let full_db = temp.path().join("full.sqlite");
    run(SyncRequest::new(&full_db, selector(&root))).unwrap();

    assert_eq!(
        projection_view(&incremental_db, id),
        projection_view(&full_db, id)
    );
    let source_files = IndexReader::open(&incremental_db)
        .unwrap()
        .source_files_for_selector(&selector(&root))
        .unwrap();
    assert_eq!(source_files.len(), 1);
    assert_eq!(source_files[0].file_path, renamed.to_string_lossy());
}

#[test]
fn append_during_strict_sync_commits_only_the_proven_prefix_and_marks_coverage_stale() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions/2026/08/15");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let path = root.join(format!("rollout-2026-08-15T00-00-00-{id}.jsonl"));
    write_session(&path, id, "/work", &[("user_message", "stable prefix")]);
    let db = temp.path().join("index.sqlite");
    let report = run_with_snapshot_hook(
        SyncRequest::new(&db, selector(&temp.path().join("sessions"))),
        SourceCatalog,
        || append_message(&path, "agent_message", "unindexed active tail", 2),
    )
    .unwrap();

    assert_eq!(report.added, 1);
    assert!(report.coverage.written);
    assert_eq!(
        report.coverage.stale_reason,
        Some(CoverageWriteStaleReason::SourceContentChanged)
    );
    let reader = IndexReader::open(&db).unwrap();
    let page = reader
        .read_page(&crate::identity::parse_session_ref(id), 0, 10)
        .unwrap();
    assert_eq!(page.total_count, 1);
    assert_eq!(page.messages[0].content_text, "stable prefix");
}

#[test]
fn private_append_keeps_logical_coverage_fresh_and_next_sync_advances_raw_cursor() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions/2026/08/15");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let path = root.join(format!("rollout-2026-08-15T00-00-00-{id}.jsonl"));
    write_session(&path, id, "/work", &[("user_message", "stable content")]);
    let db = temp.path().join("index.sqlite");
    let selector_root = temp.path().join("sessions");
    let report = run_with_snapshot_hook(
        SyncRequest::new(&db, selector(&selector_root)),
        SourceCatalog,
        || append_private_call(&path, "private tail", 2),
    )
    .unwrap();

    assert!(report.coverage.written);
    assert_eq!(report.coverage.stale_reason, None);
    let advanced = run(SyncRequest::new(&db, selector(&selector_root))).unwrap();
    assert_eq!(advanced.updated, 1);
    assert_eq!(advanced.coverage.stale_reason, None);
    let reader = IndexReader::open(&db).unwrap();
    let state = reader
        .source_files_for_paths(SourceId::Codex, &[path.to_string_lossy().into_owned()])
        .unwrap()
        .pop()
        .unwrap();
    assert_eq!(state.indexed_bytes, fs::metadata(&path).unwrap().len());
    assert_eq!(
        reader
            .read_page(&crate::identity::parse_session_ref(id), 0, 10)
            .unwrap()
            .total_count,
        1
    );
}

#[test]
fn truncate_during_strict_sync_rejects_every_operation_and_publishes_no_database() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions/2026/08/15");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let path = root.join(format!("rollout-2026-08-15T00-00-00-{id}.jsonl"));
    write_session(
        &path,
        id,
        "/work",
        &[("user_message", "original evidence that must not commit")],
    );
    let db = temp.path().join("index.sqlite");
    let failure = run_with_snapshot_hook(
        SyncRequest::new(&db, selector(&temp.path().join("sessions"))),
        SourceCatalog,
        || {
            fs::write(
                &path,
                format!(
                    "{}\n",
                    serde_json::json!({
                        "timestamp":"2026-08-15T00:00:00Z",
                        "type":"session_meta",
                        "payload":{"id":id,"cwd":"/work"}
                    })
                ),
            )
            .unwrap();
        },
    )
    .unwrap_err();

    assert!(failure.report.errors > 0);
    assert!(!db.exists());
}

#[test]
fn unavailable_source_never_creates_an_empty_database() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("missing");
    let db = temp.path().join("index.sqlite");
    let failure = run(SyncRequest::new(&db, selector(&root))).unwrap_err();
    assert_eq!(
        failure.report.coverage.reason.as_deref(),
        Some("source_unavailable")
    );
    assert!(!db.exists());
}

#[test]
fn unavailable_existing_source_invalidates_stored_coverage_without_touching_content() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    write_session(
        &root.join("session.jsonl"),
        id,
        "/work",
        &[("user_message", "stored evidence")],
    );
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();
    fs::remove_dir_all(&root).unwrap();

    let failure = run(SyncRequest::new(&db, selector(&root))).unwrap_err();
    assert_eq!(
        failure.report.coverage.reason.as_deref(),
        Some("source_unavailable")
    );
    let reader = IndexReader::open(&db).unwrap();
    assert!(reader.coverage_records(SourceId::Codex).unwrap().is_empty());
    assert_eq!(
        reader
            .read_page(&crate::identity::parse_session_ref(id), 0, 10)
            .unwrap()
            .total_count,
        1
    );
}

#[test]
fn selector_scoped_scan_does_not_ingest_other_cwds() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let day = root.join("2026/08/15");
    write_session(
        &day.join("alpha.jsonl"),
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "/work/alpha",
        &[("user_message", "alpha")],
    );
    write_session(
        &day.join("beta.jsonl"),
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "/work/beta",
        &[("user_message", "beta")],
    );
    let selected = Selector::Cwd {
        source: SourceId::Codex,
        root: root.to_string_lossy().into_owned(),
        cwd: "/work/alpha".to_owned(),
    };
    let db = temp.path().join("index.sqlite");
    let report = run(SyncRequest::new(&db, selected)).unwrap();
    assert_eq!((report.scanned, report.added), (1, 1));
    assert_eq!(
        IndexReader::open(&db)
            .unwrap()
            .stats(SourceId::Codex)
            .unwrap()
            .session_count,
        1
    );
}

#[test]
fn explicit_prune_retains_cold_presence_and_removes_only_gone_sessions() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let cold = temp.path().join("cold/2026/08/15");
    let day = root.join("2026/08/15");
    let cold_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let hot_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let gone_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    let cold_hot = day.join(format!("rollout-{cold_id}.jsonl"));
    let hot = day.join(format!("rollout-{hot_id}.jsonl"));
    let gone = day.join(format!("rollout-{gone_id}.jsonl"));
    for (path, id, message) in [
        (&cold_hot, cold_id, "cold"),
        (&hot, hot_id, "hot"),
        (&gone, gone_id, "gone"),
    ] {
        write_session(path, id, "/work", &[("user_message", message)]);
    }
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!(
        IndexReader::open(&db)
            .unwrap()
            .coverage_records(SourceId::Codex)
            .unwrap()
            .len(),
        1
    );

    fs::create_dir_all(&cold).unwrap();
    fs::write(
        cold.join(format!("rollout-{cold_id}.jsonl.zst")),
        "presence only",
    )
    .unwrap();
    fs::remove_file(cold_hot).unwrap();
    fs::remove_file(gone).unwrap();
    let mut request = SyncRequest::new(&db, selector(&root));
    request.prune = true;
    request.cold_roots = vec![temp.path().join("cold")];
    let report = run(request).unwrap();
    assert_eq!((report.removed, report.retained_cold), (1, 1));
    assert_eq!(
        IndexReader::open(&db)
            .unwrap()
            .stats(SourceId::Codex)
            .unwrap()
            .session_count,
        2
    );
}

#[cfg(unix)]
#[test]
fn prune_fails_closed_when_a_registered_cold_root_is_not_traversable() {
    struct RestorePermissions {
        path: PathBuf,
        permissions: fs::Permissions,
    }

    impl Drop for RestorePermissions {
        fn drop(&mut self) {
            let _ = fs::set_permissions(&self.path, self.permissions.clone());
        }
    }

    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let day = root.join("2026/08/15");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let hot = day.join(format!("rollout-{id}.jsonl"));
    write_session(
        &hot,
        id,
        "/work",
        &[("user_message", "must survive an unreadable cold archive")],
    );
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();

    let archive_parent = temp.path().join("archive");
    let cold_root = archive_parent.join("cold");
    let cold_day = cold_root.join("2026/08/15");
    fs::create_dir_all(&cold_day).unwrap();
    add_cold_root(
        &db,
        SourceId::Codex,
        &cold_root,
        "2026-08-15T00:00:00.000Z",
        temp.path(),
    )
    .unwrap();
    fs::rename(&hot, cold_day.join(hot.file_name().unwrap())).unwrap();

    let original_permissions = fs::metadata(&archive_parent).unwrap().permissions();
    let _restore = RestorePermissions {
        path: archive_parent.clone(),
        permissions: original_permissions.clone(),
    };
    fs::set_permissions(&archive_parent, fs::Permissions::from_mode(0o000)).unwrap();
    let metadata_error = match fs::metadata(&cold_root) {
        Err(error) => error,
        // Root can bypass mode bits. Keep the regression meaningful in such an
        // environment by replacing the already-registered path with a real
        // untraversable symlink loop; ordinary Unix CI exercises EACCES above.
        Ok(_) => {
            fs::set_permissions(&archive_parent, original_permissions).unwrap();
            fs::rename(&cold_root, archive_parent.join("cold-preserved")).unwrap();
            symlink("cold", &cold_root).unwrap();
            fs::metadata(&cold_root).unwrap_err()
        }
    };
    assert_ne!(metadata_error.kind(), std::io::ErrorKind::NotFound);

    assert_cold_prune_fails_closed(&db, &root, id);
}

#[test]
fn prune_fails_closed_when_a_registered_cold_root_becomes_a_regular_file() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let hot = root.join(format!("2026/08/15/rollout-{id}.jsonl"));
    write_session(
        &hot,
        id,
        "/work",
        &[("user_message", "must survive an invalid cold root")],
    );
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();

    let cold_root = temp.path().join("cold");
    fs::create_dir(&cold_root).unwrap();
    add_cold_root(
        &db,
        SourceId::Codex,
        &cold_root,
        "2026-08-15T00:00:00.000Z",
        temp.path(),
    )
    .unwrap();
    fs::remove_file(hot).unwrap();
    fs::remove_dir(&cold_root).unwrap();
    fs::write(&cold_root, "registered directory was replaced by a file").unwrap();

    assert_cold_prune_fails_closed(&db, &root, id);
}

#[test]
fn prune_fails_closed_when_a_registered_cold_root_is_missing() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let hot = root.join(format!("2026/08/15/rollout-{id}.jsonl"));
    write_session(
        &hot,
        id,
        "/work",
        &[("user_message", "must survive a vanished cold archive")],
    );
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();

    let cold_root = temp.path().join("cold");
    fs::create_dir(&cold_root).unwrap();
    add_cold_root(
        &db,
        SourceId::Codex,
        &cold_root,
        "2026-08-15T00:00:00.000Z",
        temp.path(),
    )
    .unwrap();
    fs::rename(&hot, cold_root.join(hot.file_name().unwrap())).unwrap();
    fs::rename(&cold_root, temp.path().join("cold-vanished")).unwrap();
    assert!(!cold_root.exists());

    for best_effort in [false, true] {
        let mut request = SyncRequest::new(&db, selector(&root));
        request.prune = true;
        request.best_effort = best_effort;
        let failure = run(request).unwrap_err();
        assert!(failure.report.error_details.iter().any(|detail| {
            detail.file_path == "(cold roots)"
                && detail
                    .message
                    .contains("registered cold root is unavailable")
        }));
        assert_eq!(projection_view(&db, id).1.len(), 1);
    }
}

#[test]
fn first_sync_imports_all_source_pending_cold_roots_into_the_published_v8_index() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let raw = root.join("2026/08/15/rollout-bootstrap.jsonl");
    write_session(
        &raw,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "/work",
        &[("user_message", "bootstrap")],
    );
    let cold = temp.path().join("cold");
    fs::create_dir_all(&cold).unwrap();
    let db = temp.path().join("index.sqlite");
    let added_at = "2026-08-15T01:02:03.004Z";
    let mut request = SyncRequest::new(&db, selector(&root));
    let claude_cold = temp.path().join("claude-cold");
    fs::create_dir_all(&claude_cold).unwrap();
    request.pending_cold_roots = vec![
        PendingColdRoot::new(SourceId::Codex, &cold, added_at),
        PendingColdRoot::new(SourceId::ClaudeCode, &claude_cold, added_at),
    ];

    let report = run(request).unwrap();
    assert!(report.coverage.written);
    assert_eq!(
        list_cold_roots(&db, Some(SourceId::Codex)).unwrap(),
        vec![RegisteredColdRoot {
            source_id: SourceId::Codex,
            root: cold.to_string_lossy().into_owned(),
            added_at: added_at.to_owned(),
        }]
    );
    assert_eq!(
        list_cold_roots(&db, Some(SourceId::ClaudeCode)).unwrap(),
        vec![RegisteredColdRoot {
            source_id: SourceId::ClaudeCode,
            root: claude_cold.to_string_lossy().into_owned(),
            added_at: added_at.to_owned(),
        }]
    );
}

#[test]
fn sync_cutover_publish_failure_rolls_back_and_never_publishes_scratch() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    write_session(
        &root.join("2026/08/15/rollout-cutover.jsonl"),
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "/work",
        &[("user_message", "must remain uncommitted")],
    );
    let db = temp.path().join("index.sqlite");
    let mut cutover = RecordingCutover {
        fail_publish: true,
        ..RecordingCutover::default()
    };
    let failure =
        run_with_cutover(SyncRequest::new(&db, selector(&root)), &mut cutover).unwrap_err();

    assert_eq!(cutover.phases, ["preflight", "publish"]);
    assert!(failure.to_string().contains("publish legacy cutover"));
    assert!(!db.exists());
}

#[test]
fn sync_cutover_complete_failure_reports_committed_but_unconfirmed_state() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    write_session(
        &root.join("2026/08/15/rollout-cutover-complete.jsonl"),
        id,
        "/work",
        &[("user_message", "committed before confirmation")],
    );
    let db = temp.path().join("index.sqlite");
    let mut cutover = RecordingCutover {
        fail_complete: true,
        ..RecordingCutover::default()
    };
    let failure =
        run_with_cutover(SyncRequest::new(&db, selector(&root)), &mut cutover).unwrap_err();

    assert_eq!(cutover.phases, ["preflight", "publish", "complete"]);
    assert!(failure.to_string().contains("index committed"));
    assert!(db.exists());
    assert_eq!(projection_view(&db, id).1.len(), 1);
}

#[test]
fn cold_cutover_can_bootstrap_metadata_only_v8_and_import_every_source() {
    let temp = tempdir().unwrap();
    let added = temp.path().join("cold-added");
    let inherited = temp.path().join("cold-inherited");
    fs::create_dir_all(&added).unwrap();
    fs::create_dir_all(&inherited).unwrap();
    let db = temp.path().join("index.sqlite");
    let pending = vec![PendingColdRoot::new(
        SourceId::ClaudeCode,
        &inherited,
        "2026-08-15T00:00:00.000Z",
    )];
    let mut cutover = RecordingCutover::default();
    let result = add_cold_root_with_cutover(
        &db,
        SourceId::Codex,
        &added,
        "2026-08-15T00:00:01.000Z",
        temp.path(),
        Some(&pending),
        &mut cutover,
    )
    .unwrap();

    assert!(result.changed);
    assert_eq!(cutover.phases, ["preflight", "publish", "complete"]);
    assert_eq!(list_cold_roots(&db, None).unwrap().len(), 2);
    assert_eq!(
        IndexReader::open(&db)
            .unwrap()
            .stats(SourceId::Codex)
            .unwrap()
            .session_count,
        0
    );
}

#[test]
fn cold_remove_bootstraps_only_when_legacy_state_exists() {
    let temp = tempdir().unwrap();
    let target = temp.path().join("target");
    let retained = temp.path().join("retained");
    fs::create_dir_all(&target).unwrap();
    fs::create_dir_all(&retained).unwrap();

    let absent_db = temp.path().join("absent.sqlite");
    let mut absent_cutover = RecordingCutover::default();
    let absent = remove_cold_root_with_cutover(
        &absent_db,
        SourceId::Codex,
        &target,
        temp.path(),
        None,
        &mut absent_cutover,
    )
    .unwrap();
    assert!(!absent.changed);
    assert!(absent_cutover.phases.is_empty());
    assert!(!absent_db.exists());

    let db = temp.path().join("bootstrap.sqlite");
    let pending = vec![
        PendingColdRoot::new(SourceId::Codex, &target, "2026-08-15T00:00:00.000Z"),
        PendingColdRoot::new(SourceId::Pi, &retained, "2026-08-15T00:00:01.000Z"),
    ];
    let mut cutover = RecordingCutover::default();
    let removed = remove_cold_root_with_cutover(
        &db,
        SourceId::Codex,
        &target,
        temp.path(),
        Some(&pending),
        &mut cutover,
    )
    .unwrap();
    assert!(removed.changed);
    assert_eq!(cutover.phases, ["preflight", "publish", "complete"]);
    assert!(
        list_cold_roots(&db, Some(SourceId::Codex))
            .unwrap()
            .is_empty()
    );
    assert_eq!(list_cold_roots(&db, Some(SourceId::Pi)).unwrap().len(), 1);
}

#[test]
fn removed_v8_root_is_not_resurrected_by_stale_pending_json_and_no_longer_retains() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let raw = root.join("2026/08/15").join(format!("rollout-{id}.jsonl"));
    write_session(&raw, id, "/work", &[("user_message", "retain once")]);
    let cold = temp.path().join("cold/2026/08/15");
    fs::create_dir_all(&cold).unwrap();
    fs::write(cold.join(format!("rollout-{id}.jsonl.zst")), "presence").unwrap();
    let cold_root = temp.path().join("cold");
    let db = temp.path().join("index.sqlite");
    let added_at = "2026-08-15T01:02:03.004Z";
    let mut bootstrap = SyncRequest::new(&db, selector(&root));
    bootstrap.pending_cold_roots =
        vec![PendingColdRoot::new(SourceId::Codex, &cold_root, added_at)];
    run(bootstrap).unwrap();
    fs::remove_file(&raw).unwrap();

    let mut retained = SyncRequest::new(&db, selector(&root));
    retained.prune = true;
    let report = run(retained).unwrap();
    assert_eq!((report.removed, report.retained_cold), (0, 1));

    let removed = remove_cold_root(&db, SourceId::Codex, &cold_root, temp.path()).unwrap();
    assert!(removed.changed);
    assert!(removed.entry.is_some());
    let already_removed = remove_cold_root(&db, SourceId::Codex, &cold_root, temp.path()).unwrap();
    assert_eq!(
        already_removed,
        ColdRootMutation {
            changed: false,
            entry: None,
        }
    );

    // This simulates a stale, unconsumed legacy JSON file. Existing v8 state
    // is authoritative, so the bootstrap input is ignored rather than
    // resurrecting the removed registration.
    let mut stale = SyncRequest::new(&db, selector(&root));
    stale.prune = true;
    stale.pending_cold_roots = vec![PendingColdRoot::new(SourceId::Codex, &cold_root, added_at)];
    let report = run(stale).unwrap();
    assert_eq!((report.removed, report.retained_cold), (1, 0));
    assert!(
        list_cold_roots(&db, Some(SourceId::Codex))
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        IndexReader::open(&db)
            .unwrap()
            .stats(SourceId::Codex)
            .unwrap()
            .session_count,
        0
    );
}

#[test]
fn cold_root_writer_waits_for_the_same_lock_as_sync() {
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    write_session(
        &root.join("2026/08/15/rollout-lock.jsonl"),
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "/work",
        &[("user_message", "lock")],
    );
    let cold = temp.path().join("cold");
    fs::create_dir_all(&cold).unwrap();
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();

    let sync_lock = super::lock::SyncLock::acquire(&db).unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let db_for_writer = db.clone();
    let cold_for_writer = cold.clone();
    let cwd = temp.path().to_path_buf();
    let handle = thread::spawn(move || {
        started_tx.send(()).unwrap();
        let result = add_cold_root(
            &db_for_writer,
            SourceId::Codex,
            &cold_for_writer,
            "2026-08-15T01:02:03.004Z",
            &cwd,
        );
        result_tx.send(result).unwrap();
    });
    started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(matches!(
        result_rx.recv_timeout(Duration::from_millis(150)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));

    drop(sync_lock);
    let result = result_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap()
        .unwrap();
    assert!(result.changed);
    let entry = result.entry.unwrap();
    assert_eq!(entry.root, cold.to_string_lossy());
    let duplicate = add_cold_root(
        &db,
        SourceId::Codex,
        &cold,
        "2099-01-01T00:00:00.000Z",
        temp.path(),
    )
    .unwrap();
    assert!(!duplicate.changed);
    assert_eq!(duplicate.entry.unwrap().added_at, entry.added_at);
    assert_eq!(
        list_cold_roots(&db, Some(SourceId::Codex)).unwrap().len(),
        1
    );
    handle.join().unwrap();
}

#[test]
fn cold_root_writer_never_creates_a_missing_index() {
    let temp = tempdir().unwrap();
    let cold = temp.path().join("cold");
    fs::create_dir_all(&cold).unwrap();
    let db = temp.path().join("missing/index.sqlite");

    let error = add_cold_root(
        &db,
        SourceId::Codex,
        &cold,
        "2026-08-15T01:02:03.004Z",
        temp.path(),
    )
    .unwrap_err();
    assert!(matches!(error, SyncStateError::IndexUnavailable { .. }));
    assert_eq!(error.code(), "index_unavailable");
    assert!(!db.exists());

    let v7 = temp.path().join("v7.sqlite");
    rusqlite::Connection::open(&v7)
        .unwrap()
        .execute_batch(
            "CREATE TABLE sessions(\
               source_id TEXT NOT NULL,\
               native_session_id TEXT NOT NULL,\
               session_key TEXT NOT NULL\
             );\
             CREATE TABLE messages(id INTEGER PRIMARY KEY);",
        )
        .unwrap();
    let error = add_cold_root(
        &v7,
        SourceId::Codex,
        &cold,
        "2026-08-15T01:02:03.004Z",
        temp.path(),
    )
    .unwrap_err();
    assert!(matches!(
        error,
        SyncStateError::IndexSchemaUpgradeRequired { .. }
    ));
    assert_eq!(error.code(), "index_schema_upgrade_required");
}

#[test]
fn strict_scan_failure_keeps_the_active_index_unchanged() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let good = root.join("good.jsonl");
    write_session(
        &good,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "/work",
        &[("user_message", "durable")],
    );
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!(
        IndexReader::open(&db)
            .unwrap()
            .coverage_records(SourceId::Codex)
            .unwrap()
            .len(),
        1
    );

    let bad = root.join("bad.jsonl");
    write_session(
        &bad,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "/work",
        &[("user_message", "must not partially commit")],
    );
    let _injection = inject_metadata_failure(&bad);
    let failed = run(SyncRequest::new(&db, selector(&root))).unwrap_err();
    assert_eq!(failed.report.scanned, 2);
    assert_eq!(failed.report.errors, 1);
    assert_eq!(
        failed.report.coverage.reason.as_deref(),
        Some("source_scan_incomplete")
    );
    assert_eq!(
        IndexReader::open(&db)
            .unwrap()
            .stats(SourceId::Codex)
            .unwrap()
            .session_count,
        1
    );
    assert!(
        IndexReader::open(&db)
            .unwrap()
            .coverage_records(SourceId::Codex)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn best_effort_scan_failure_commits_readable_files_without_coverage_or_prune() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let good = root.join("good.jsonl");
    let bad = root.join("bad.jsonl");
    write_session(
        &good,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "/work",
        &[("user_message", "readable evidence")],
    );
    write_session(
        &bad,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "/work",
        &[("user_message", "metadata failure")],
    );
    let db = temp.path().join("index.sqlite");
    let _injection = inject_metadata_failure(&bad);
    let mut request = SyncRequest::new(&db, selector(&root));
    request.best_effort = true;
    request.prune = true;
    let report = run(request).unwrap();

    assert_eq!(report.scanned, 2);
    assert_eq!((report.added, report.updated), (1, 0));
    assert_eq!(report.errors, 1);
    assert_eq!(report.error_details.len(), 1);
    assert!(!report.coverage.written);
    assert_eq!(report.coverage.reason.as_deref(), Some("best_effort"));
    assert_eq!(report.removed, 0);
    assert_eq!(
        IndexReader::open(&db)
            .unwrap()
            .stats(SourceId::Codex)
            .unwrap()
            .session_count,
        1
    );
}

#[test]
fn narrow_best_effort_partial_invalidates_covering_broad_coverage() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let good = root.join("good.jsonl");
    let bad = root.join("bad.jsonl");
    write_session(
        &good,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "/work/alpha",
        &[("user_message", "old readable evidence")],
    );
    write_session(
        &bad,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "/work/alpha",
        &[("user_message", "temporarily unavailable")],
    );
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!(
        IndexReader::open(&db)
            .unwrap()
            .coverage_records(SourceId::Codex)
            .unwrap()
            .len(),
        1
    );

    append_message(&good, "agent_message", "new readable evidence", 2);
    append_private_call(&bad, "force metadata refresh", 2);
    let _injection = inject_metadata_failure(&bad);
    let narrow = Selector::Cwd {
        source: SourceId::Codex,
        root: root.to_string_lossy().into_owned(),
        cwd: "/work/alpha".to_owned(),
    };
    let mut request = SyncRequest::new(&db, narrow);
    request.best_effort = true;
    let report = run(request).unwrap();

    assert_eq!((report.updated, report.errors), (1, 1));
    assert!(!report.coverage.written);
    assert!(
        IndexReader::open(&db)
            .unwrap()
            .coverage_records(SourceId::Codex)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn broad_best_effort_partial_invalidates_existing_narrow_coverage() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let good = root.join("good.jsonl");
    let bad = root.join("bad.jsonl");
    write_session(
        &good,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "/work/alpha",
        &[("user_message", "old readable evidence")],
    );
    write_session(
        &bad,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "/work/alpha",
        &[("user_message", "temporarily unavailable")],
    );
    let db = temp.path().join("index.sqlite");
    let narrow = Selector::Cwd {
        source: SourceId::Codex,
        root: root.to_string_lossy().into_owned(),
        cwd: "/work/alpha".to_owned(),
    };
    run(SyncRequest::new(&db, narrow)).unwrap();
    assert_eq!(
        IndexReader::open(&db)
            .unwrap()
            .coverage_records(SourceId::Codex)
            .unwrap()
            .len(),
        1
    );

    append_message(&good, "agent_message", "new readable evidence", 2);
    append_private_call(&bad, "force metadata refresh", 2);
    let _injection = inject_metadata_failure(&bad);
    let mut request = SyncRequest::new(&db, selector(&root));
    request.best_effort = true;
    let report = run(request).unwrap();

    assert_eq!((report.updated, report.errors), (1, 1));
    assert!(!report.coverage.written);
    assert!(
        IndexReader::open(&db)
            .unwrap()
            .coverage_records(SourceId::Codex)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn scratch_path_is_adjacent_and_never_aliases_the_active_database() {
    let active = PathBuf::from("/tmp/state/index.sqlite");
    let scratch = scratch_index_path(&active);
    assert_eq!(scratch.parent(), active.parent());
    assert_ne!(scratch, active);
}

#[test]
fn codex_response_item_rollouts_are_indexed_without_injected_context() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let day = root.join("2026/08/15");
    let id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    let path = day.join(format!("rollout-2026-08-15T00-00-00-{id}.jsonl"));
    fs::create_dir_all(&day).unwrap();
    let lines = [
        serde_json::json!({
            "timestamp":"2026-08-15T00:00:00Z",
            "type":"session_meta",
            "payload":{"id":id,"cwd":"/work"}
        }),
        serde_json::json!({
            "timestamp":"2026-08-15T00:00:01Z",
            "type":"response_item",
            "payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"developer scaffolding"}]}
        }),
        serde_json::json!({
            "timestamp":"2026-08-15T00:00:02Z",
            "type":"response_item",
            "payload":{
                "type":"message",
                "role":"user",
                "content":[{"type":"input_text","text":"<environment_context>injected context</environment_context>"}],
                "internal_chat_message_metadata_passthrough":{"content_item_kinds":["environments.environment_context"]}
            }
        }),
        serde_json::json!({
            "timestamp":"2026-08-15T00:00:03Z",
            "type":"response_item",
            "payload":{
                "type":"message",
                "role":"user",
                "content":[{"type":"input_text","text":"新格式 rollout 用户消息"}],
                "internal_chat_message_metadata_passthrough":{"content_item_kinds":["user.text"]}
            }
        }),
        serde_json::json!({
            "timestamp":"2026-08-15T00:00:04Z",
            "type":"response_item",
            "payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"新格式 rollout 助手回复"}]}
        }),
    ];
    let body = lines
        .iter()
        .map(|line| line.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&path, format!("{body}\n")).unwrap();

    let db = temp.path().join("index.sqlite");
    let report = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!((report.added, report.errors), (1, 0));

    let (session, messages) = projection_view(&db, &format!("codex:{id}"));
    assert_eq!(session.title, "新格式 rollout 用户消息");
    let texts = messages
        .iter()
        .map(|message| message.content_text.as_str())
        .collect::<Vec<_>>();
    assert!(
        texts
            .iter()
            .any(|text| text.contains("新格式 rollout 用户消息"))
    );
    assert!(
        texts
            .iter()
            .any(|text| text.contains("新格式 rollout 助手回复"))
    );
    assert!(!texts.iter().any(|text| text.contains("injected context")));
    assert!(
        !texts
            .iter()
            .any(|text| text.contains("developer scaffolding"))
    );
}

#[test]
fn codex_interpretation_upgrade_replays_empty_and_nonempty_consumed_cursors() {
    for (legacy_count, version) in [(0, "v1"), (1, "v1"), (1, "v2")] {
        let temp = tempdir().unwrap();
        let root = temp.path().join("sessions");
        let id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        let path = root.join(format!("rollout-2026-08-15T00-00-00-{id}.jsonl"));
        let legacy_messages = if legacy_count == 0 {
            vec![]
        } else {
            vec![("user_message", "legacy evidence")]
        };
        write_session(&path, id, "/work", &legacy_messages);
        let db = temp.path().join("incremental.sqlite");
        run(SyncRequest::new(&db, selector(&root))).unwrap();
        let mut prior = load_existing_state(&SyncRequest::new(&db, selector(&root)))
            .unwrap()
            .source_files
            .remove(0);
        let mut checkpoint = persisted_checkpoint(&prior).unwrap();
        append_response(&path, "assistant", "recovered response evidence", 2);

        // Faithfully model an old adapter that consumed this response_item but
        // did not project it: same raw prefix proof, EOF cursor, old reduction.
        let file = SourceCatalog
            .scan(&selector(&root), &SourceMetadataCache::default())
            .unwrap()
            .files
            .remove(0);
        checkpoint.indexed_bytes = file.size;
        checkpoint.prefix_digest = fingerprint_prefix(&path, file.size).unwrap();
        let mut reducer: serde_json::Value =
            serde_json::from_str(&checkpoint.reducer_state).unwrap();
        let object = reducer.as_object_mut().unwrap();
        object.remove("interpretation");
        object.remove("message_mirror");
        object.remove("turn_id");
        checkpoint.reducer_state = reducer.to_string();
        prior.size = file.size;
        prior.indexed_bytes = file.size;
        prior.head_digest = checkpoint.prefix_digest.clone();
        prior.boundary_digest = checkpoint.prefix_digest.clone();
        prior.mtime_ms = file.mtime_ms;
        prior.mtime_ns = exact_mtime_ns(file.mtime_ns);
        prior.extra_fingerprint = format!("accepted-{version}:codex:old");
        prior.reducer_checkpoint = Some(serde_json::to_vec(&checkpoint).unwrap());
        let mut writer = IndexWriter::open_v8(&db).unwrap();
        let mut transaction = writer.begin().unwrap();
        transaction.upsert_source_file(&prior).unwrap();
        transaction.commit().unwrap();
        drop(writer);

        let upgraded = run(SyncRequest::new(&db, selector(&root))).unwrap();
        assert!(upgraded.coverage.written);
        let full_db = temp.path().join("full.sqlite");
        run(SyncRequest::new(&full_db, selector(&root))).unwrap();
        assert_eq!(projection_view(&db, id), projection_view(&full_db, id));
        assert_eq!(projection_view(&db, id).1.len(), legacy_count + 1);
        let noop = run(SyncRequest::new(&db, selector(&root))).unwrap();
        assert_eq!((noop.updated, noop.skipped), (0, 1));
    }
}

#[test]
fn valid_empty_cursor_accepts_first_message_on_append() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let day = root.join("2026/08/15");
    let id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    let path = day.join(format!("rollout-2026-08-15T00-00-00-{id}.jsonl"));
    fs::create_dir_all(&day).unwrap();
    // First sync accepts the profile but has no message yet.
    fs::write(
        &path,
        format!(
            "{}\n",
            serde_json::json!({
                "timestamp":"2026-08-15T00:00:00Z",
                "type":"response_item",
                "payload":{"type":"reasoning","summary":[{"text":"only reasoning so far"}]}
            })
        ),
    )
    .unwrap();
    let db = temp.path().join("index.sqlite");
    let first = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!((first.added, first.skipped), (0, 1));

    // The file later gains a record the projector now understands.
    let mut file = OpenOptions::new().append(true).open(&path).unwrap();
    writeln!(
        file,
        "{}",
        serde_json::json!({
            "timestamp":"2026-08-15T00:00:01Z",
            "type":"response_item",
            "payload":{
                "type":"message",
                "role":"user",
                "content":[{"type":"input_text","text":"recovered rollout evidence"}],
                "internal_chat_message_metadata_passthrough":{"content_item_kinds":["user.text"]}
            }
        })
    )
    .unwrap();
    drop(file);

    let second = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!((second.added, second.errors), (1, 0));
    let (_, messages) = projection_view(&db, &format!("codex:{id}"));
    assert!(
        messages
            .iter()
            .any(|message| message.content_text.contains("recovered rollout evidence")),
        "the first message must be indexed after a valid empty cursor"
    );
}

#[test]
fn paginated_continuation_segment_does_not_overwrite_its_parent_session() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let day = root.join("2026/08/30");
    fs::create_dir_all(&day).unwrap();
    let base = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let segment = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let parent = day.join(format!("rollout-2026-08-30T00-00-00-{base}.jsonl"));
    let continuation = day.join(format!(
        "rollout-2026-08-30T06-00-00-{base}_{segment}.jsonl"
    ));
    let message_line = |text: &str, timestamp: &str| {
        serde_json::json!({
            "timestamp":timestamp,
            "type":"response_item",
            "payload":{
                "type":"message",
                "role":"user",
                "content":[{"type":"input_text","text":text}],
                "internal_chat_message_metadata_passthrough":{"content_item_kinds":["user.text"]}
            }
        })
        .to_string()
    };
    fs::write(
        &parent,
        format!(
            "{}\n{}\n",
            serde_json::json!({
                "timestamp":"2026-08-30T00:00:00Z",
                "type":"session_meta",
                "payload":{"id":base,"cwd":"/work"}
            }),
            message_line("parent segment evidence", "2026-08-30T00:00:01Z"),
        ),
    )
    .unwrap();
    fs::write(
        &continuation,
        format!(
            "{}\n{}\n",
            serde_json::json!({
                "timestamp":"2026-08-30T06:00:00Z",
                "type":"session_meta",
                "payload":{
                    "id":base,
                    "cwd":"/work",
                    "history_base":{"thread_id":base,"end_ordinal_exclusive":10}
                }
            }),
            message_line("continuation segment evidence", "2026-08-30T06:00:01Z"),
        ),
    )
    .unwrap();

    let db = temp.path().join("index.sqlite");
    let report = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!((report.added, report.errors), (2, 0));

    let (parent_session, parent_messages) = projection_view(&db, &format!("codex:{base}"));
    assert_eq!(parent_session.native_session_id, base);
    assert!(
        parent_messages
            .iter()
            .any(|message| message.content_text.contains("parent segment evidence"))
    );
    let (segment_session, segment_messages) = projection_view(&db, &format!("codex:{segment}"));
    assert_eq!(segment_session.native_session_id, segment);
    assert!(segment_messages.iter().any(|message| {
        message
            .content_text
            .contains("continuation segment evidence")
    }));

    for step in 0..3 {
        append_response(
            &continuation,
            "assistant",
            &format!("segment append {step}"),
            10 + step,
        );
        append_message(
            &parent,
            "agent_message",
            &format!("parent append {step}"),
            20 + step,
        );
        let appended = run(SyncRequest::new(&db, selector(&root))).unwrap();
        assert_eq!((appended.updated, appended.errors), (2, 0));
        let full_db = temp.path().join(format!("full-{step}.sqlite"));
        run(SyncRequest::new(&full_db, selector(&root))).unwrap();
        for id in [base, segment] {
            let mut incremental = projection_view(&db, id);
            let mut full = projection_view(&full_db, id);
            // SQLite row allocation depends on parallel projection order.
            incremental.0.id = 0;
            full.0.id = 0;
            assert_eq!(incremental, full);
        }
    }
}

#[test]
fn mixed_codex_stream_matches_full_replay_after_every_record() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    let path = root.join(format!("rollout-2026-08-15T00-00-00-{id}.jsonl"));
    write_session(&path, id, "/work", &[]);
    let event = |kind: &str, text: &str| {
        serde_json::json!({
            "timestamp":"2026-08-15T00:00:01Z", "type":"event_msg",
            "payload":{"type":kind,"message":text}
        })
    };
    let records = vec![
        (response_line("user", "paired question", 1), 1),
        (event("user_message", "paired question"), 1),
        (event("agent_message", "paired answer"), 2),
        (response_line("assistant", "paired answer", 2), 2),
        (response_line("assistant", "same genuine message", 3), 3),
        (response_line("assistant", "same genuine message", 4), 4),
        (event("agent_message", "same genuine message"), 4),
        (event("agent_message", "event only"), 5),
        (event("agent_message", "event only"), 6),
        (response_line("user", "repeat in another turn", 5), 7),
        (event("task_complete", ""), 7),
        (event("task_started", ""), 7),
        (event("user_message", "repeat in another turn"), 8),
        (response_line("user", "repeat in another turn", 6), 8),
        (response_line("assistant", "new response only", 7), 9),
        // Rejected records neither become evidence nor break a mirror pair.
        (
            serde_json::json!({"timestamp":"2026-08-15T00:00:08Z", "type":"response_item",
            "payload":{"type":"function_call","arguments":"private"}}),
            9,
        ),
        (event("agent_message", "new response only"), 9),
        (
            serde_json::json!({"timestamp":"2026-08-15T00:00:09Z", "type":"turn_context",
            "payload":{"turn_id":"one", "model":"test-model"}}),
            9,
        ),
        (event("user_message", "context boundary"), 10),
        (
            serde_json::json!({"timestamp":"2026-08-15T00:00:10Z", "type":"turn_context",
            "payload":{"turn_id":"two", "model":"test-model"}}),
            10,
        ),
        (response_line("user", "context boundary", 11), 11),
    ];
    let db = temp.path().join("incremental.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();
    for (step, (record, count)) in records.into_iter().enumerate() {
        writeln!(
            OpenOptions::new().append(true).open(&path).unwrap(),
            "{record}"
        )
        .unwrap();
        run(SyncRequest::new(&db, selector(&root))).unwrap();
        let full_db = temp.path().join(format!("full-{step}.sqlite"));
        run(SyncRequest::new(&full_db, selector(&root))).unwrap();
        let incremental = projection_view(&db, id);
        assert_eq!(incremental.1.len(), count, "step {step}");
        assert_eq!(incremental, projection_view(&full_db, id), "step {step}");
    }
}

#[test]
fn pagination_fallback_identity_and_repeated_metadata_stay_stable() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let base = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let stem = format!("rollout-2026-08-15T00-00-00-{base}");
    let path = root.join(format!("{stem}.jsonl"));
    fs::create_dir_all(&root).unwrap();
    let meta = serde_json::json!({"timestamp":"2026-08-15T00:00:00Z", "type":"session_meta",
        "payload":{"id":base,"cwd":"/work","history_base":{"thread_id":base,"end_ordinal_exclusive":5}}});
    fs::write(
        &path,
        format!("{meta}\n{}\n", response_line("user", "fallback segment", 1)),
    )
    .unwrap();
    let db = temp.path().join("incremental.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();
    writeln!(
        OpenOptions::new().append(true).open(&path).unwrap(),
        "{meta}"
    )
    .unwrap();
    append_response(&path, "assistant", "fallback appended", 2);
    run(SyncRequest::new(&db, selector(&root))).unwrap();
    let full_db = temp.path().join("full.sqlite");
    run(SyncRequest::new(&full_db, selector(&root))).unwrap();
    assert_eq!(
        projection_view(&db, &stem),
        projection_view(&full_db, &stem)
    );
    assert_eq!(projection_view(&db, &stem).1.len(), 2);

    let cold = temp.path().join("cold");
    fs::create_dir(&cold).unwrap();
    fs::rename(&path, cold.join(path.file_name().unwrap())).unwrap();
    let mut request = SyncRequest::new(&db, selector(&root));
    request.prune = true;
    request.cold_roots = vec![cold];
    let retained = run(request).unwrap();
    assert_eq!((retained.removed, retained.retained_cold), (0, 1));
    assert_eq!(projection_view(&db, &stem).1.len(), 2);
}

fn claude_line(session_id: &str, kind: &str, text: &str, second: u64) -> String {
    serde_json::json!({
        "type": kind,
        "sessionId": session_id,
        "cwd": "/work/resume",
        "timestamp": format!("2026-09-26T00:00:{second:02}Z"),
        "message": {"content": text},
    })
    .to_string()
}

#[test]
fn claude_code_resume_copy_keeps_both_files_as_distinct_sessions() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("projects");
    let project = root.join("-work-resume");
    fs::create_dir_all(&project).unwrap();
    let parent = "11111111-1111-4111-8111-111111111111";
    let resumed = "22222222-2222-4222-8222-222222222222";
    let history = [
        claude_line(parent, "user", "original question", 1),
        claude_line(parent, "assistant", "original answer", 2),
    ];
    fs::write(
        project.join(format!("{parent}.jsonl")),
        format!("{}\n", history.join("\n")),
    )
    .unwrap();
    // Claude Code resumes into a new file that copies the parent's records,
    // parent sessionId included, before continuing under its own id.
    let mut copied = history.to_vec();
    copied.push(claude_line(resumed, "user", "resumed follow-up", 3));
    fs::write(
        project.join(format!("{resumed}.jsonl")),
        format!("{}\n", copied.join("\n")),
    )
    .unwrap();

    let db = temp.path().join("index.sqlite");
    let selected = Selector::All {
        source: SourceId::ClaudeCode,
        root: root.to_string_lossy().into_owned(),
    };
    let report = run(SyncRequest::new(&db, selected)).unwrap();
    assert_eq!((report.scanned, report.added), (2, 2));
    let reader = IndexReader::open(&db).unwrap();
    assert!(reader.check_invariants().unwrap().is_valid());
    assert_eq!(reader.stats(SourceId::ClaudeCode).unwrap().session_count, 2);
}
