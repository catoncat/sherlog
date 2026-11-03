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
    for (legacy_count, version) in [(0, "v1"), (1, "v1"), (1, "v2"), (1, "v3")] {
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

fn source_file_paths(db: &Path) -> Vec<String> {
    let connection = Connection::open(db).unwrap();
    let mut statement = connection
        .prepare("SELECT file_path FROM source_files ORDER BY file_path")
        .unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

fn session_file_path(db: &Path) -> Vec<(String, String)> {
    let connection = Connection::open(db).unwrap();
    let mut statement = connection
        .prepare("SELECT file_path, source_root FROM session_rows ORDER BY file_path")
        .unwrap();
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

/// Codex archives a session by moving its rollout from the dated hot tree to
/// `archived_sessions/`. Syncing the archive root must rebind the existing
/// session to the new path, not attach a second source file to it.
#[test]
fn archived_move_rebinds_the_session_to_its_new_path() {
    let temp = tempdir().unwrap();
    let hot = temp.path().join("sessions");
    let archived = temp.path().join("archived_sessions");
    fs::create_dir_all(&archived).unwrap();
    let id = "019f9033-a3bd-7b00-9a37-50e2f05e455e";
    let name = format!("rollout-2026-08-15T00-00-00-{id}.jsonl");
    let hot_path = hot.join("2026/08/15").join(&name);
    let archived_path = archived.join(&name);
    write_session(
        &hot_path,
        id,
        "/work",
        &[("user_message", "before archive")],
    );
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&hot))).unwrap();

    // The session grows after the indexed snapshot, then Codex archives it,
    // so the stale hot cursor's next_seq no longer matches the session.
    append_message(&hot_path, "agent_message", "after archive", 2);
    fs::rename(&hot_path, &archived_path).unwrap();

    let report = run(SyncRequest::new(&db, selector(&archived))).unwrap();
    assert_eq!(report.errors, 0, "{:?}", report.error_details);
    let reader = IndexReader::open(&db).unwrap();
    assert!(reader.check_invariants().unwrap().is_valid());
    assert_eq!(
        source_file_paths(&db),
        vec![archived_path.to_string_lossy().into_owned()]
    );
    assert_eq!(
        session_file_path(&db),
        vec![(
            archived_path.to_string_lossy().into_owned(),
            archived.to_string_lossy().into_owned()
        )]
    );
    let (_, messages) = projection_view(&db, id);
    assert_eq!(messages.len(), 2);

    // A later hot sync with prune neither resurrects nor drops the session.
    let mut request = SyncRequest::new(&db, selector(&hot));
    request.prune = true;
    request.cold_roots = vec![archived.clone()];
    let report = run(request).unwrap();
    assert_eq!(report.errors, 0, "{:?}", report.error_details);
    assert_eq!(session_file_path(&db).len(), 1);
    assert_eq!(source_file_paths(&db).len(), 1);
    assert!(
        IndexReader::open(&db)
            .unwrap()
            .check_invariants()
            .unwrap()
            .is_valid()
    );
}

/// The same move inside one root without `--prune` must not leave a second
/// cursor at the vanished path either.
#[test]
fn hot_move_without_prune_keeps_one_source_file() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let original = root.join(format!("2026/08/15/rollout-original-{id}.jsonl"));
    let moved = root.join(format!("2026/08/16/rollout-original-{id}.jsonl"));
    write_session(&original, id, "/work", &[("user_message", "one")]);
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();

    append_message(&original, "agent_message", "two", 2);
    fs::create_dir_all(moved.parent().unwrap()).unwrap();
    fs::rename(&original, &moved).unwrap();
    let report = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!(report.errors, 0, "{:?}", report.error_details);
    assert!(
        IndexReader::open(&db)
            .unwrap()
            .check_invariants()
            .unwrap()
            .is_valid()
    );
    assert_eq!(
        source_file_paths(&db),
        vec![moved.to_string_lossy().into_owned()]
    );
    assert_eq!(projection_view(&db, id).1.len(), 2);
}

/// A copy is not a move: while the indexed path still exists, a second file
/// with the same session identity is refused on its own.
#[test]
fn archived_copy_is_a_per_file_duplicate_error() {
    let temp = tempdir().unwrap();
    let hot = temp.path().join("sessions");
    let archived = temp.path().join("archived_sessions");
    fs::create_dir_all(&archived).unwrap();
    let id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    let other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    let name = format!("rollout-2026-08-15T00-00-00-{id}.jsonl");
    let hot_path = hot.join("2026/08/15").join(&name);
    write_session(&hot_path, id, "/work", &[("user_message", "kept")]);
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&hot))).unwrap();
    fs::copy(&hot_path, archived.join(&name)).unwrap();
    write_session(
        &archived.join(format!("rollout-2026-08-15T00-00-01-{other}.jsonl")),
        other,
        "/work",
        &[("user_message", "unrelated archived session")],
    );

    let failure = run(SyncRequest::new(&db, selector(&archived))).unwrap_err();
    assert_eq!(failure.report.errors, 1);
    assert!(
        failure.report.error_details[0]
            .message
            .contains("duplicate")
    );
    assert_eq!(
        source_file_paths(&db),
        vec![hot_path.to_string_lossy().into_owned()]
    );

    let mut request = SyncRequest::new(&db, selector(&archived));
    request.best_effort = true;
    let report = run(request).unwrap();
    assert_eq!((report.errors, report.added), (1, 1));
    let reader = IndexReader::open(&db).unwrap();
    assert!(reader.check_invariants().unwrap().is_valid());
    assert_eq!(source_file_paths(&db).len(), 2);
    assert!(
        source_file_paths(&db).contains(&hot_path.to_string_lossy().into_owned()),
        "the original binding is kept"
    );
}

/// Claude Code shares the write path: a transcript moved to another root is
/// rebound to its new path as the same session.
#[test]
fn claude_code_moved_transcript_rebinds_the_session() {
    let temp = tempdir().unwrap();
    let hot = temp.path().join("projects");
    let cold = temp.path().join("claude-archive");
    let id = "33333333-3333-4333-8333-333333333333";
    let line = |kind: &str, text: &str, second: u64| {
        serde_json::json!({
            "type": kind,
            "sessionId": id,
            "cwd": "/work/move",
            "timestamp": format!("2026-09-26T00:00:{second:02}Z"),
            "message": {"content": text},
        })
        .to_string()
    };
    let hot_path = hot.join("-work-move").join(format!("{id}.jsonl"));
    let cold_path = cold.join("-work-move").join(format!("{id}.jsonl"));
    fs::create_dir_all(hot_path.parent().unwrap()).unwrap();
    fs::create_dir_all(cold_path.parent().unwrap()).unwrap();
    fs::write(&hot_path, format!("{}\n", line("user", "question", 1))).unwrap();
    let claude = |root: &Path| Selector::All {
        source: SourceId::ClaudeCode,
        root: root.to_string_lossy().into_owned(),
    };
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, claude(&hot))).unwrap();

    let mut file = OpenOptions::new().append(true).open(&hot_path).unwrap();
    writeln!(file, "{}", line("assistant", "answer", 2)).unwrap();
    drop(file);
    fs::rename(&hot_path, &cold_path).unwrap();

    let report = run(SyncRequest::new(&db, claude(&cold))).unwrap();
    assert_eq!(report.errors, 0, "{:?}", report.error_details);
    let reader = IndexReader::open(&db).unwrap();
    assert!(reader.check_invariants().unwrap().is_valid());
    assert_eq!(reader.stats(SourceId::ClaudeCode).unwrap().session_count, 1);
    assert_eq!(
        source_file_paths(&db),
        vec![cold_path.to_string_lossy().into_owned()]
    );
    assert_eq!(
        session_file_path(&db),
        vec![(
            cold_path.to_string_lossy().into_owned(),
            cold.to_string_lossy().into_owned()
        )]
    );
}

/// One Codex rollout's storage on disk: the plain file and/or its compressed
/// twin, each holding the first `n` messages of the same session.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct RolloutForms {
    plain: Option<usize>,
    compressed: Option<usize>,
}

const ROLLOUT_MESSAGES: [(&str, &str); 2] = [
    ("user_message", "storage move question"),
    ("agent_message", "storage move answer"),
];

fn rollout_bytes(id: &str, messages: usize) -> Vec<u8> {
    let scratch = tempdir().unwrap();
    let path = scratch.path().join("rollout.jsonl");
    write_session(&path, id, "/work", &ROLLOUT_MESSAGES[..messages]);
    fs::read(path).unwrap()
}

/// Codex's own encoding: one zstd stream of the plain bytes, published by
/// rename so a compressed file is never observed half written.
fn write_compressed_rollout(path: &Path, plain: &[u8]) {
    let staging = path.with_extension("zst.compress.tmp");
    fs::write(&staging, zstd::stream::encode_all(plain, 3).unwrap()).unwrap();
    fs::rename(&staging, path).unwrap();
}

fn apply_rollout_forms(plain_path: &Path, id: &str, forms: RolloutForms) {
    fs::create_dir_all(plain_path.parent().unwrap()).unwrap();
    let compressed_path = PathBuf::from(format!("{}.zst", plain_path.to_string_lossy()));
    match forms.plain {
        Some(messages) => {
            let wanted = rollout_bytes(id, messages);
            match fs::read(plain_path) {
                Ok(current) if current == wanted => {}
                // Codex appends to a live rollout in place.
                Ok(current) if wanted.starts_with(&current) => {
                    OpenOptions::new()
                        .append(true)
                        .open(plain_path)
                        .unwrap()
                        .write_all(&wanted[current.len()..])
                        .unwrap();
                }
                _ => {
                    let staging = plain_path.with_extension("materialize.tmp");
                    fs::write(&staging, wanted).unwrap();
                    fs::rename(&staging, plain_path).unwrap();
                }
            }
        }
        None => {
            let _ = fs::remove_file(plain_path);
        }
    }
    match forms.compressed {
        Some(messages) => {
            let wanted = rollout_bytes(id, messages);
            let current = fs::read(&compressed_path)
                .ok()
                .and_then(|bytes| zstd::stream::decode_all(&bytes[..]).ok());
            if current.as_deref() != Some(&wanted[..]) {
                write_compressed_rollout(&compressed_path, &wanted);
            }
        }
        None => {
            let _ = fs::remove_file(&compressed_path);
        }
    }
}

/// Everything sync persists for a selector except row ids, write times and
/// file mtimes: session rows, every document with its raw locator, and every
/// source cursor with its digests and linked session.
fn persisted_projection(db: &Path) -> Vec<String> {
    let connection = Connection::open(db).unwrap();
    let mut rows = Vec::new();
    for sql in [
        "SELECT 'session', native_session_id, file_path, source_root, title, summary_text, \
         cwd, model, started_at, ended_at, path_date, message_count, document_count, \
         raw_file_size FROM session_rows ORDER BY native_session_id",
        "SELECT 'document', s.native_session_id, d.kind, d.seq, d.role, d.timestamp, \
         d.body_text, d.title_text, d.summary_text, d.raw_start, d.raw_end \
         FROM documents d JOIN session_rows s ON s.id=d.session_id \
         ORDER BY s.native_session_id, d.kind, d.seq",
        "SELECT 'source_file', sf.file_path, sf.size, sf.indexed_bytes, sf.next_seq, \
         sf.head_digest, sf.boundary_digest, sf.cwd, sf.path_date, sf.extra_fingerprint, \
         s.native_session_id FROM source_files sf LEFT JOIN session_rows s \
         ON s.id=sf.session_id ORDER BY sf.file_path",
    ] {
        let mut statement = connection.prepare(sql).unwrap();
        let columns = statement.column_count();
        let mut query = statement.query([]).unwrap();
        while let Some(row) = query.next().unwrap() {
            let fields = (0..columns)
                .map(|index| format!("{:?}", row.get::<_, rusqlite::types::Value>(index).unwrap()))
                .collect::<Vec<_>>();
            rows.push(fields.join("|"));
        }
    }
    rows
}

/// Bounded exhaustive check of the `incremental == full replay` invariant over
/// Codex storage moves. A rollout's on-disk state is its plain file and/or its
/// compressed twin, each with one or two messages, or nothing at all. Every
/// two-step sequence of those states, and every three-step sequence of the
/// states Codex itself produces (live plain file, appended plain file,
/// compressed file, both during compression or resume), is synced step by
/// step into one index. After every step the index must equal a fresh full
/// sync of the same files, keep its invariants, and hold at most one session
/// read from at most one file.
#[test]
fn codex_storage_moves_match_full_replay_for_every_bounded_sequence() {
    let forms = [None, Some(1), Some(2)];
    let every = forms
        .iter()
        .flat_map(|plain| {
            forms.iter().map(|compressed| RolloutForms {
                plain: *plain,
                compressed: *compressed,
            })
        })
        .collect::<Vec<_>>();
    let present = every
        .iter()
        .copied()
        .filter(|state| state.plain.is_some() || state.compressed.is_some())
        .collect::<Vec<_>>();
    let codex_written = [
        RolloutForms {
            plain: Some(1),
            compressed: None,
        },
        RolloutForms {
            plain: Some(2),
            compressed: None,
        },
        RolloutForms {
            plain: None,
            compressed: Some(2),
        },
        RolloutForms {
            plain: Some(2),
            compressed: Some(2),
        },
    ];
    let temp = tempdir().unwrap();
    let mut full_replay = HashMap::new();
    let mut checked = 0;
    // Without prune a vanished rollout keeps its projection by design, so only
    // prune runs may visit the empty state.
    for (prune, states, length) in [
        (false, &present[..], 2),
        (true, &every[..], 2),
        (false, &codex_written[..], 3),
        (true, &codex_written[..], 3),
    ] {
        for sequence in state_sequences(states, length) {
            check_storage_sequence(temp.path(), prune, &sequence, &mut full_replay);
            checked += 1;
        }
    }
    assert_eq!(checked, 8 * 8 + 9 * 9 + 2 * 4 * 4 * 4);
}

fn state_sequences(states: &[RolloutForms], length: usize) -> Vec<Vec<RolloutForms>> {
    (0..length).fold(vec![Vec::new()], |prefixes, _| {
        prefixes
            .iter()
            .flat_map(|prefix| {
                states.iter().map(move |state| {
                    let mut next = prefix.clone();
                    next.push(*state);
                    next
                })
            })
            .collect()
    })
}

fn check_storage_sequence(
    workspace: &Path,
    prune: bool,
    sequence: &[RolloutForms],
    full_replay: &mut HashMap<RolloutForms, Vec<String>>,
) {
    let id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    let root = workspace.join("sessions");
    let plain_path = root.join(format!("2026/08/15/rollout-2026-08-15T00-00-00-{id}.jsonl"));
    let _ = fs::remove_dir_all(&root);
    let db = workspace.join("incremental.sqlite");
    let _ = fs::remove_file(&db);
    for (step, state) in sequence.iter().enumerate() {
        apply_rollout_forms(&plain_path, id, *state);
        let mut request = SyncRequest::new(&db, selector(&root));
        request.prune = prune;
        run(request)
            .unwrap_or_else(|failure| panic!("prune={prune} {sequence:?} step {step}: {failure}"));
        let expected = full_replay.entry(*state).or_insert_with(|| {
            let fresh = workspace.join("full.sqlite");
            let _ = fs::remove_file(&fresh);
            run(SyncRequest::new(&fresh, selector(&root))).unwrap();
            let projection = persisted_projection(&fresh);
            let count = |kind: &str| {
                projection
                    .iter()
                    .filter(|row| row.starts_with(&format!("Text(\"{kind}\")")))
                    .count()
            };
            let present = usize::from(state.plain.is_some() || state.compressed.is_some());
            assert_eq!((count("session"), count("source_file")), (present, present));
            projection
        });
        let reader = IndexReader::open(&db).unwrap();
        assert!(reader.check_invariants().unwrap().is_valid());
        assert_eq!(
            &persisted_projection(&db),
            expected,
            "prune={prune} {sequence:?} step {step}"
        );
    }
}

#[test]
fn archiving_into_a_compressed_rollout_moves_the_session_instead_of_duplicating_it() {
    let temp = tempdir().unwrap();
    let sessions = temp.path().join("sessions");
    let archived = temp.path().join("archived_sessions");
    fs::create_dir_all(&archived).unwrap();
    let moved = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    let only_compressed = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    let name = format!("rollout-2026-08-15T00-00-00-{moved}.jsonl");
    let hot = sessions.join("2026/08/15").join(&name);
    write_session(&hot, moved, "/work", &ROLLOUT_MESSAGES);
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&sessions))).unwrap();
    let before = projection_view(&db, moved);

    // Codex archives the rollout into the flat archive root and later
    // compresses it there; a second session is only ever seen compressed.
    write_compressed_rollout(
        &archived.join(format!("{name}.zst")),
        &fs::read(&hot).unwrap(),
    );
    fs::remove_file(&hot).unwrap();
    write_compressed_rollout(
        &archived.join(format!(
            "rollout-2026-08-16T00-00-00-{only_compressed}.jsonl.zst"
        )),
        &rollout_bytes(only_compressed, 1),
    );
    // A compression temp file and an unrelated `.zst` are never decoded.
    fs::write(
        archived.join("rollout-x.jsonl.zst.compress.1.tmp"),
        b"partial",
    )
    .unwrap();
    fs::write(archived.join("notes.zst"), b"not a rollout").unwrap();

    let report = run(SyncRequest::new(&db, selector(&archived))).unwrap();
    assert_eq!((report.scanned, report.added, report.updated), (2, 2, 0));
    let after = projection_view(&db, moved);
    assert_eq!(after.1, before.1);
    assert_eq!(after.0.id, before.0.id);
    assert_eq!(
        after.0.file_path,
        archived.join(format!("{name}.zst")).to_string_lossy()
    );
    assert_eq!(projection_view(&db, only_compressed).1.len(), 1);

    // Pruning the hot root drops only its stale cursor, never the session.
    let mut request = SyncRequest::new(&db, selector(&sessions));
    request.prune = true;
    assert_eq!(run(request).unwrap().removed, 0);
    let reader = IndexReader::open(&db).unwrap();
    assert!(reader.check_invariants().unwrap().is_valid());
    assert_eq!(reader.stats(SourceId::Codex).unwrap().session_count, 2);
    assert_eq!(projection_view(&db, moved).1, before.1);
    let cursors = Connection::open(&db)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM source_files", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap();
    assert_eq!(cursors, 2);

    // A compressed rollout is immutable; a no-op sync re-reads nothing.
    let noop = run(SyncRequest::new(&db, selector(&archived))).unwrap();
    assert_eq!((noop.added, noop.updated, noop.skipped), (0, 0, 2));
}

#[test]
fn compressing_an_indexed_rollout_in_place_counts_as_an_update() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let id = "abababab-abab-4bab-8bab-abababababab";
    let plain = root.join(format!("2026/08/15/rollout-2026-08-15T00-00-00-{id}.jsonl"));
    write_session(&plain, id, "/work", &ROLLOUT_MESSAGES);
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();
    write_compressed_rollout(
        &PathBuf::from(format!("{}.zst", plain.to_string_lossy())),
        &fs::read(&plain).unwrap(),
    );
    fs::remove_file(&plain).unwrap();
    let report = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!((report.added, report.updated), (0, 1));
    assert!(report.coverage.written);
}

/// An index written before segment identity came from the filename holds an
/// older `<base>_<segment>` rollout (no `history_base`) under the base id,
/// while the base itself was invisible as `.jsonl.zst`. Upgrading must replay
/// that cursor as the segment's own session and then index the base, instead
/// of refusing the base as a duplicate of the still-present segment. With the
/// base elsewhere (archived, outside the synced root) nothing takes the old
/// session over, so the segment's replace must drop it itself.
#[test]
fn upgrade_rekeys_a_segment_indexed_under_its_base_identity() {
    check_segment_rekey_upgrade(true);
    check_segment_rekey_upgrade(false);
}

fn check_segment_rekey_upgrade(base_in_root: bool) {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let base = "acacacac-acac-4cac-8cac-acacacacacac";
    let segment = "bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd";
    let segment_path = root.join(format!(
        "2026/08/30/rollout-2026-08-30T00-00-00-{base}_{segment}.jsonl"
    ));
    write_session(
        &segment_path,
        base,
        "/work",
        &[("user_message", "segment evidence")],
    );
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();

    // Rewrite what the current adapter stored into what the v3 adapter
    // stored: the segment's session under the base id, a v3 cursor.
    let connection = Connection::open(&db).unwrap();
    connection
        .execute(
            "UPDATE session_rows SET native_session_id=?1, session_uuid=?1, \
             session_key='codex:' || ?1 WHERE native_session_id=?2",
            [base, segment],
        )
        .unwrap();
    connection
        .execute(
            "UPDATE source_files SET \
             extra_fingerprint=replace(extra_fingerprint, 'accepted-v4:', 'accepted-v3:'), \
             reducer_checkpoint=CAST(replace(CAST(reducer_checkpoint AS TEXT), \
               'accepted-v4:', 'accepted-v3:') AS BLOB)",
            [],
        )
        .unwrap();
    drop(connection);
    assert_eq!(
        projection_view(&db, base).0.file_path,
        segment_path.to_string_lossy()
    );

    if base_in_root {
        let base_dir = root.join("2026/08/01");
        fs::create_dir_all(&base_dir).unwrap();
        write_compressed_rollout(
            &base_dir.join(format!("rollout-2026-08-01T00-00-00-{base}.jsonl.zst")),
            &rollout_bytes(base, 1),
        );
    }
    let upgraded = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!(
        (upgraded.errors, upgraded.added, upgraded.updated),
        (0, u64::from(base_in_root), 1)
    );
    assert!(upgraded.coverage.written);
    let full = temp.path().join("full.sqlite");
    run(SyncRequest::new(&full, selector(&root))).unwrap();
    assert_eq!(persisted_projection(&db), persisted_projection(&full));

    append_message(&segment_path, "agent_message", "segment append", 9);
    let appended = run(SyncRequest::new(&db, selector(&root))).unwrap();
    assert_eq!((appended.errors, appended.updated), (0, 1));
    let full = temp.path().join("full-appended.sqlite");
    run(SyncRequest::new(&full, selector(&root))).unwrap();
    assert_eq!(persisted_projection(&db), persisted_projection(&full));
    assert!(
        IndexReader::open(&db)
            .unwrap()
            .check_invariants()
            .unwrap()
            .is_valid()
    );
}

/// While a resumed rollout exists in both forms the scan selects only the
/// plain file. If that file is left out of the write (deferred while Codex
/// appends to it, or refused under `--best-effort`), `--prune` must still see
/// the session's raw file as present and keep the session bound to the
/// compressed twin.
#[test]
fn prune_keeps_a_session_whose_compressed_twin_is_shadowed_by_an_omitted_plain_file() {
    let temp = tempdir().unwrap();
    let root = temp.path().join("sessions");
    let id = "cececece-cece-4ece-8ece-cececececece";
    let name = format!("rollout-2026-08-15T00-00-00-{id}.jsonl");
    let plain = root.join("2026/08/15").join(&name);
    fs::create_dir_all(plain.parent().unwrap()).unwrap();
    write_compressed_rollout(
        &PathBuf::from(format!("{}.zst", plain.to_string_lossy())),
        &rollout_bytes(id, 1),
    );
    let db = temp.path().join("index.sqlite");
    run(SyncRequest::new(&db, selector(&root))).unwrap();
    let before = projection_view(&db, id);

    // Resume materializes the plain twin; a stray copy of it elsewhere in the
    // root makes both plain files refused duplicates of one session.
    fs::write(&plain, rollout_bytes(id, 2)).unwrap();
    let copy = root.join("2026/08/16").join(&name);
    fs::create_dir_all(copy.parent().unwrap()).unwrap();
    fs::copy(&plain, &copy).unwrap();
    let mut request = SyncRequest::new(&db, selector(&root));
    request.best_effort = true;
    request.prune = true;
    let report = run(request).unwrap();
    assert_eq!((report.errors, report.removed), (2, 0));
    let after = projection_view(&db, id);
    assert_eq!(after, before);
    assert!(
        IndexReader::open(&db)
            .unwrap()
            .check_invariants()
            .unwrap()
            .is_valid()
    );
}
