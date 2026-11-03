use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Duration;

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OpenFlags, OptionalExtension, Row, params, params_from_iter};

use crate::config::INDEX_VERSION;
use crate::identity::{DEFAULT_SOURCE_ID, SessionIdentity, SessionRef, SourceId};
use crate::model::{
    CoverageFreshness, CoverageRecord, CoverageStatus, CwdCount, MessageRecord, MessageRole,
    ReadCoverage, ReadPageSummary, ReadRangeSummary, SessionListEntry, SessionListQuery,
    SessionListSort, SessionRecord, StatsSummary,
};
use crate::selector::{Selector, selector_implies};

use super::schema::{BUSY_TIMEOUT_MS, detect_layout, read_metadata, table_exists};
use super::{
    ANALYZER_EPOCH, COVERAGE_EPOCH, CandidateEvidence, ColdRoot, DocumentKind, IndexError,
    IndexLayout, IndexMetadata, IndexResult, InvariantReport, PROJECTION_EPOCH, RecallOrder,
    RecallSpec, SessionBundle, SourceFileState, StoredDocument, StoredSession,
};

pub struct IndexReader {
    connection: Connection,
    path: PathBuf,
    layout: IndexLayout,
    metadata: IndexMetadata,
}

impl IndexReader {
    /// Open an existing index without CREATE and force SQLite query-only mode.
    /// This method never migrates or repairs a schema.
    pub fn open(path: impl AsRef<Path>) -> IndexResult<Self> {
        let path = path.as_ref().to_path_buf();
        if !path.exists() {
            return Err(IndexError::NotFound(path));
        }
        let connection = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        connection.busy_timeout(Duration::from_millis(BUSY_TIMEOUT_MS))?;
        connection.pragma_update(None, "query_only", "ON")?;
        connection.pragma_update(None, "temp_store", "MEMORY")?;
        let layout = detect_layout(&connection)?;
        let metadata = read_metadata(&connection, layout)?;
        Ok(Self {
            connection,
            path,
            layout,
            metadata,
        })
    }

    pub const fn layout(&self) -> IndexLayout {
        self.layout
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn metadata(&self) -> &IndexMetadata {
        &self.metadata
    }

    pub fn stats(&self, source: SourceId) -> IndexResult<StatsSummary> {
        let (session_count, message_count, earliest_started_at, latest_ended_at, last_sync_at) =
            self.connection.query_row(
                "SELECT COUNT(*), COALESCE(SUM(message_count), 0), MIN(started_at), \
                 MAX(ended_at), MAX(updated_at) FROM sessions WHERE source_id=?",
                [source.as_str()],
                |row| {
                    Ok((
                        non_negative(row.get::<_, i64>(0)?, "session count")?,
                        non_negative(row.get::<_, i64>(1)?, "message count")?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )?;

        let mut statement = self.connection.prepare(
            "SELECT cwd, COUNT(*) FROM sessions \
             WHERE source_id=? AND cwd<>'' GROUP BY cwd \
             ORDER BY COUNT(*) DESC, cwd ASC LIMIT 10",
        )?;
        let top_cwds = statement
            .query_map([source.as_str()], |row| {
                Ok(CwdCount {
                    cwd: row.get(0)?,
                    count: non_negative(row.get::<_, i64>(1)?, "cwd count")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(StatsSummary {
            session_count,
            message_count,
            earliest_started_at,
            latest_ended_at,
            top_cwds,
            index_version: self.metadata.index_version.clone(),
            db_path: self.path.to_string_lossy().into_owned(),
            db_size_bytes: fs::metadata(&self.path)
                .map(|value| value.len())
                .unwrap_or(0),
            last_sync_at,
            coverage: self.coverage_records(source)?,
        })
    }

    pub fn list(&self, query: &SessionListQuery) -> IndexResult<Vec<SessionListEntry>> {
        self.require_v8("list")?;
        let mut conditions = Vec::new();
        let mut values = Vec::new();
        if let Some(selector) = &query.selector {
            add_selector_filter(&mut conditions, &mut values, selector, "sessions")?;
        } else {
            conditions.push("source_id=?".to_owned());
            values.push(sql_text(
                query.source_id.unwrap_or(DEFAULT_SOURCE_ID).as_str(),
            ));
        }
        if let Some(cwd) = query.cwd.as_deref().filter(|value| !value.is_empty()) {
            conditions.push("lower(cwd) LIKE ? ESCAPE '\\'".to_owned());
            values.push(format!("%{}%", escape_like(&cwd.to_lowercase())).into());
        }
        if let Some(since) = query.since.as_deref().filter(|value| !value.is_empty()) {
            conditions.push("ended_at>=?".to_owned());
            values.push(sql_text(since));
        }
        let order = match query.sort {
            SessionListSort::Ended => "ended_at",
            SessionListSort::Started => "started_at",
            SessionListSort::Messages => "message_count",
        };
        values.push(to_i64(query.limit, "list limit")?.into());
        let sql = format!(
            "SELECT session_uuid, title, summary_text, cwd, started_at, ended_at, \
             path_date, message_count FROM sessions WHERE {} ORDER BY {order} DESC LIMIT ?",
            conditions.join(" AND ")
        );
        let mut statement = self.connection.prepare(&sql)?;
        let results = statement
            .query_map(params_from_iter(values), |row| {
                Ok(SessionListEntry {
                    session_uuid: row.get(0)?,
                    title: row.get(1)?,
                    summary_text: row.get(2)?,
                    cwd: row.get(3)?,
                    started_at: row.get(4)?,
                    ended_at: row.get(5)?,
                    path_date: row.get(6)?,
                    message_count: non_negative(row.get::<_, i64>(7)?, "message count")?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(results)
    }

    pub fn load_session(&self, session_ref: &SessionRef) -> IndexResult<Option<SessionRecord>> {
        self.require_v8("load session")?;
        Ok(self
            .load_stored_session(session_ref)?
            .map(|session| public_session(&session)))
    }

    pub fn read_page(
        &self,
        session_ref: &SessionRef,
        offset: u64,
        limit: u64,
    ) -> IndexResult<ReadPageSummary> {
        self.require_v8("read-page")?;
        let session = self.require_stored_session(session_ref)?;
        let messages = self.messages_for_page(
            session.id,
            to_i64(offset, "read offset")?,
            to_i64(limit, "read limit")?,
        )?;
        let total_count = session.message_count;
        let returned = u64::try_from(messages.len()).unwrap_or(u64::MAX);
        let has_more = offset.saturating_add(returned) < total_count;
        Ok(ReadPageSummary {
            session: public_session(&session),
            offset,
            limit,
            total_count,
            has_more,
            messages,
            coverage: ReadCoverage {
                entries: self.coverage_for_stored_session(&session)?,
            },
        })
    }

    pub fn read_range(
        &self,
        session_ref: &SessionRef,
        anchor_seq: i64,
        before: u64,
        after: u64,
    ) -> IndexResult<ReadRangeSummary> {
        self.require_v8("read-range")?;
        let session = self.require_stored_session(session_ref)?;
        let before = i64::try_from(before).unwrap_or(i64::MAX);
        let after = i64::try_from(after).unwrap_or(i64::MAX);
        let range_start_seq = anchor_seq.saturating_sub(before).max(0);
        let range_end_seq = anchor_seq.saturating_add(after);
        let messages = self.messages_for_range(session.id, range_start_seq, range_end_seq)?;
        Ok(ReadRangeSummary {
            session: public_session(&session),
            anchor_seq,
            range_start_seq,
            range_end_seq,
            messages,
            coverage: ReadCoverage {
                entries: self.coverage_for_stored_session(&session)?,
            },
        })
    }

    pub fn coverage_records(&self, source: SourceId) -> IndexResult<Vec<CoverageRecord>> {
        if !table_exists(&self.connection, "coverage")? {
            return Ok(Vec::new());
        }
        if self.layout == IndexLayout::V8 && self.metadata.coverage_epoch != COVERAGE_EPOCH {
            return Ok(Vec::new());
        }
        if self.layout == IndexLayout::V8 {
            let mut statement = self.connection.prepare(
                "SELECT id, source_id, selector_json, source_fingerprint, \
                 source_file_set_fingerprint, source_file_count, indexed_session_count, \
                 completed_at, index_version FROM coverage \
                 WHERE source_id=? AND projection_epoch=? AND analyzer_epoch=? \
                 AND coverage_epoch=? AND index_version=? \
                 ORDER BY completed_at DESC, id DESC",
            )?;
            let records = statement
                .query_map(
                    params![
                        source.as_str(),
                        PROJECTION_EPOCH,
                        ANALYZER_EPOCH,
                        COVERAGE_EPOCH,
                        INDEX_VERSION
                    ],
                    coverage_from_row,
                )?
                .collect::<Result<Vec<_>, _>>()?;
            return Ok(records);
        }
        let mut statement = self.connection.prepare(
            "SELECT id, source_id, selector_json, source_fingerprint, \
             source_file_set_fingerprint, source_file_count, indexed_session_count, \
             completed_at, index_version FROM coverage \
             WHERE source_id=? ORDER BY completed_at DESC, id DESC",
        )?;
        let records = statement
            .query_map([source.as_str()], coverage_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(records)
    }

    pub fn source_files_for_paths(
        &self,
        source: SourceId,
        paths: &[String],
    ) -> IndexResult<Vec<SourceFileState>> {
        self.require_v8("source_files_for_paths")?;
        if paths.is_empty() {
            return Ok(Vec::new());
        }
        let mut values = Vec::with_capacity(paths.len() + 1);
        values.push(sql_text(source.as_str()));
        values.extend(paths.iter().map(|path| sql_text(path)));
        let sql = format!(
            "{} WHERE sf.source_id=? AND sf.file_path IN ({}) ORDER BY sf.file_path",
            source_file_select(),
            vec!["?"; paths.len()].join(",")
        );
        self.query_source_files(&sql, values)
    }

    pub fn source_files_for_selector(
        &self,
        selector: &Selector,
    ) -> IndexResult<Vec<SourceFileState>> {
        self.require_v8("source_files_for_selector")?;
        let mut conditions = Vec::new();
        let mut values = Vec::new();
        add_selector_filter(&mut conditions, &mut values, selector, "sf")?;
        let sql = format!(
            "{} WHERE {} ORDER BY sf.file_path",
            source_file_select(),
            conditions.join(" AND ")
        );
        self.query_source_files(&sql, values)
    }

    /// Every raw file path the index currently binds to `identity`: the
    /// session row's own `file_path` plus each source-file cursor attached to
    /// it, across all roots. Empty when the session is not indexed.
    pub fn session_file_bindings(&self, identity: &SessionIdentity) -> IndexResult<Vec<String>> {
        self.require_v8("session_file_bindings")?;
        let mut statement = self.connection.prepare_cached(
            "SELECT s.file_path FROM session_rows s \
             WHERE s.source_id=?1 AND s.native_session_id=?2 \
             UNION \
             SELECT sf.file_path FROM source_files sf JOIN session_rows s ON s.id=sf.session_id \
             WHERE s.source_id=?1 AND s.native_session_id=?2 \
             ORDER BY 1",
        )?;
        let paths = statement
            .query_map(
                params![identity.source_id.as_str(), identity.native_session_id],
                |row| row.get::<_, String>(0),
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(paths)
    }

    pub fn cold_roots(&self, source: Option<SourceId>) -> IndexResult<Vec<ColdRoot>> {
        self.require_v8("cold_roots")?;
        let (sql, values) = match source {
            Some(source) => (
                "SELECT source_id, root, added_at FROM cold_roots \
                 WHERE source_id=? ORDER BY source_id, root",
                vec![sql_text(source.as_str())],
            ),
            None => (
                "SELECT source_id, root, added_at FROM cold_roots ORDER BY source_id, root",
                Vec::new(),
            ),
        };
        let mut statement = self.connection.prepare(sql)?;
        let rows = statement
            .query_map(params_from_iter(values), |row| {
                Ok(ColdRoot {
                    source_id: parse_source(&row.get::<_, String>(0)?)?,
                    root: row.get(1)?,
                    added_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Stored coverage only. Freshness remains `not_checked`; live proof belongs
    /// to the coverage module and may inspect raw source separately.
    pub fn coverage_status(&self, requested: &Selector) -> IndexResult<CoverageStatus> {
        let covering_selectors = self
            .coverage_records(requested.source())?
            .into_iter()
            .filter(|record| {
                self.coverage_version_is_current(&record.index_version)
                    && selector_implies(&record.selector, requested)
            })
            .collect::<Vec<_>>();
        Ok(CoverageStatus {
            requested: Some(requested.clone()),
            complete: !covering_selectors.is_empty(),
            freshness: CoverageFreshness::NotChecked,
            stale_reason: None,
            covering_selectors,
        })
    }

    /// Return the indexed corpus size for a selector without inspecting raw
    /// source files. Query commands use this for `scannedMessageCount` so the
    /// read path remains independent from source freshness probing.
    pub fn selector_message_count(&self, selector: &Selector) -> IndexResult<u64> {
        let mut conditions = Vec::new();
        let mut values = Vec::new();
        add_selector_filter(&mut conditions, &mut values, selector, "sessions")?;
        let message_document_count: i64 = self.connection.query_row(
            &format!(
                "SELECT COALESCE(SUM(message_count), 0) FROM sessions WHERE {}",
                conditions.join(" AND ")
            ),
            params_from_iter(values),
            |row| row.get(0),
        )?;
        Ok(non_negative(
            message_document_count,
            "selector message count",
        )?)
    }

    pub fn recall(&self, spec: &RecallSpec) -> IndexResult<Vec<CandidateEvidence>> {
        if spec.limit == 0 {
            return Ok(Vec::new());
        }
        let like_needle = spec
            .like_needle
            .as_deref()
            .filter(|needle| !needle.is_empty());
        if !spec.terms.is_empty() && like_needle.is_some() {
            return Err(IndexError::InvalidOperation(
                "recall terms and like_needle are mutually exclusive".to_owned(),
            ));
        }
        if spec.terms.is_empty() && like_needle.is_none() {
            return Ok(Vec::new());
        }
        if let Some(selector) = &spec.selector
            && !spec.sources.is_empty()
            && !spec.sources.contains(&selector.source())
        {
            return Err(IndexError::InvalidOperation(
                "recall selector source must be present in RecallSpec.sources".to_owned(),
            ));
        }
        if let Some(session) = &spec.session
            && !spec.sources.is_empty()
            && !spec.sources.contains(&session.source_id)
        {
            return Err(IndexError::InvalidOperation(
                "recall session source must be present in RecallSpec.sources".to_owned(),
            ));
        }
        self.require_v8("recall")?;
        match (self.layout, like_needle) {
            (IndexLayout::V8, Some(needle)) => self.recall_v8_like(spec, needle),
            (IndexLayout::V8, None) => self.recall_v8(spec),
            (IndexLayout::V7, _) => unreachable!("recall is gated to v8 above"),
        }
    }

    /// Export only stored projection. No raw transcript is consulted, so this
    /// remains usable for cold-only sessions during copy migration.
    pub fn export_session_bundle(&self, session_ref: &SessionRef) -> IndexResult<SessionBundle> {
        self.require_v8("export session bundle")?;
        let session = self.require_stored_session(session_ref)?;
        let documents = self.load_v8_documents(session.id)?;
        let source_files = self.source_files_for_session(&session)?;
        Ok(SessionBundle {
            session,
            documents,
            source_files,
        })
    }

    pub fn check_invariants(&self) -> IndexResult<InvariantReport> {
        self.require_v8("check invariants")?;
        inspect_v8_invariants(&self.connection)
    }

    pub fn ensure_invariants(&self) -> IndexResult<InvariantReport> {
        let report = self.check_invariants()?;
        if report.is_valid() {
            Ok(report)
        } else {
            Err(IndexError::Invariant(report.violations.join("; ")))
        }
    }

    fn load_stored_session(&self, session_ref: &SessionRef) -> IndexResult<Option<StoredSession>> {
        self.require_v8("load session")?;
        let sql = "SELECT id, source_id, native_session_id, session_key, session_uuid, file_path, \
             source_root, title, summary_text, compact_text, reasoning_summary_text, cwd, model, \
             started_at, ended_at, path_date, message_count, document_count, raw_file_mtime, \
             raw_file_size, index_version, updated_at FROM sessions \
             WHERE source_id=? AND native_session_id=? LIMIT 1";
        self.connection
            .query_row(
                sql,
                params![
                    session_ref.source_id.as_str(),
                    session_ref.native_session_id
                ],
                stored_session_from_row,
            )
            .optional()
            .map_err(Into::into)
    }

    fn require_stored_session(&self, session_ref: &SessionRef) -> IndexResult<StoredSession> {
        self.load_stored_session(session_ref)?
            .ok_or_else(|| IndexError::SessionNotFound(session_ref.qualified()))
    }

    fn messages_for_page(
        &self,
        session_id: i64,
        offset: i64,
        limit: i64,
    ) -> IndexResult<Vec<MessageRecord>> {
        let sql = "SELECT s.session_uuid, d.seq, d.role, d.body_text, d.timestamp, d.source_kind \
                 FROM documents d JOIN sessions s ON s.id=d.session_id \
                 WHERE d.session_id=? AND d.kind='message' ORDER BY d.seq LIMIT ? OFFSET ?";
        let mut statement = self.connection.prepare(sql)?;
        let messages = statement
            .query_map(params![session_id, limit, offset], message_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(messages)
    }

    fn messages_for_range(
        &self,
        session_id: i64,
        start: i64,
        end: i64,
    ) -> IndexResult<Vec<MessageRecord>> {
        let sql = "SELECT s.session_uuid, d.seq, d.role, d.body_text, d.timestamp, d.source_kind \
                 FROM documents d JOIN sessions s ON s.id=d.session_id \
                 WHERE d.session_id=? AND d.kind='message' AND d.seq BETWEEN ? AND ? ORDER BY d.seq";
        let mut statement = self.connection.prepare(sql)?;
        let messages = statement
            .query_map(params![session_id, start, end], message_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(messages)
    }

    fn coverage_for_stored_session(
        &self,
        session: &StoredSession,
    ) -> IndexResult<Vec<CoverageRecord>> {
        let root = if session.source_root.is_empty() {
            session_root_from_file(&session.file_path)
        } else {
            session.source_root.clone()
        };
        let all = Selector::All {
            source: session.identity.source_id,
            root: root.clone(),
        };
        let cwd = Selector::Cwd {
            source: session.identity.source_id,
            root: root.clone(),
            cwd: session.cwd.clone(),
        };
        let mut selectors = vec![all, cwd];
        if !session.path_date.is_empty() {
            selectors.push(Selector::DateRange {
                source: session.identity.source_id,
                root: root.clone(),
                from_date: session.path_date.clone(),
                to_date: session.path_date.clone(),
            });
            selectors.push(Selector::CwdDateRange {
                source: session.identity.source_id,
                root,
                cwd: session.cwd.clone(),
                from_date: session.path_date.clone(),
                to_date: session.path_date.clone(),
            });
        }
        Ok(self
            .coverage_records(session.identity.source_id)?
            .into_iter()
            .filter(|entry| {
                selectors
                    .iter()
                    .any(|selector| selector_implies(&entry.selector, selector))
            })
            .collect())
    }

    fn coverage_version_is_current(&self, index_version: &str) -> bool {
        self.metadata.coverage_epoch == COVERAGE_EPOCH && index_version == INDEX_VERSION
    }

    fn recall_v8(&self, spec: &RecallSpec) -> IndexResult<Vec<CandidateEvidence>> {
        let mut conditions = vec!["documents_fts MATCH ?".to_owned()];
        let mut values = vec![fts_match(&spec.terms).into()];
        add_recall_scope(&mut conditions, &mut values, spec, "s")?;
        values.push(to_i64(spec.limit as u64, "recall limit")?.into());
        let order = recall_order_sql(spec.order, "score", "s", Some("d"));
        let sql = format!(
            "SELECT d.id, s.id, s.source_id, s.session_key, s.session_uuid, s.title, \
             s.summary_text, s.compact_text, s.reasoning_summary_text, s.cwd, s.started_at, \
             s.ended_at, s.message_count, d.kind, d.seq, d.role, d.timestamp, d.body_text, \
             d.raw_start, d.raw_end, \
             bm25(documents_fts, 1.0, 8.0, 3.0, 4.0, 1.2) AS score \
             FROM documents_fts JOIN documents d ON d.id=documents_fts.rowid \
             JOIN sessions s ON s.id=d.session_id \
             WHERE {} ORDER BY {order} LIMIT ?",
            conditions.join(" AND ")
        );
        let mut statement = self.connection.prepare(&sql)?;
        let candidates = statement
            .query_map(params_from_iter(values), candidate_v8_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(candidates)
    }

    fn recall_v8_like(
        &self,
        spec: &RecallSpec,
        needle: &str,
    ) -> IndexResult<Vec<CandidateEvidence>> {
        let pattern = format!("%{}%", escape_like(needle));
        let mut conditions = vec![
            "(d.body_text LIKE ? ESCAPE '\\' OR d.title_text LIKE ? ESCAPE '\\' OR \
             d.summary_text LIKE ? ESCAPE '\\' OR d.compact_text LIKE ? ESCAPE '\\' OR \
             d.reasoning_text LIKE ? ESCAPE '\\')"
                .to_owned(),
        ];
        let mut values = (0..5)
            .map(|_| sql_text(&pattern))
            .collect::<Vec<SqlValue>>();
        add_recall_scope(&mut conditions, &mut values, spec, "s")?;
        values.push(to_i64(spec.limit as u64, "recall limit")?.into());
        let order = recall_order_sql(spec.order, "score", "s", Some("d"));
        let sql = format!(
            "SELECT d.id, s.id, s.source_id, s.session_key, s.session_uuid, s.title, \
             s.summary_text, s.compact_text, s.reasoning_summary_text, s.cwd, s.started_at, \
             s.ended_at, s.message_count, d.kind, d.seq, d.role, d.timestamp, d.body_text, \
             d.raw_start, d.raw_end, 0.0 AS score \
             FROM documents d JOIN sessions s ON s.id=d.session_id \
             WHERE {} ORDER BY {order} LIMIT ?",
            conditions.join(" AND ")
        );
        let mut statement = self.connection.prepare(&sql)?;
        let candidates = statement
            .query_map(params_from_iter(values), candidate_v8_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(candidates)
    }

    fn load_v8_documents(&self, session_id: i64) -> IndexResult<Vec<StoredDocument>> {
        let mut statement = self.connection.prepare(
            "SELECT id, kind, seq, role, timestamp, source_kind, body_text, title_text, \
             summary_text, compact_text, reasoning_text, raw_start, raw_end, projection_epoch \
             FROM documents WHERE session_id=? \
             ORDER BY CASE kind WHEN 'session_profile' THEN 0 ELSE 1 END, seq",
        )?;
        let documents = statement
            .query_map([session_id], stored_document_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(documents)
    }

    fn source_files_for_session(
        &self,
        session: &StoredSession,
    ) -> IndexResult<Vec<SourceFileState>> {
        let sql = format!(
            "{} WHERE sf.session_id=? ORDER BY sf.source_id, sf.file_path",
            source_file_select()
        );
        self.query_source_files(&sql, vec![SqlValue::from(session.id)])
    }

    fn query_source_files(
        &self,
        sql: &str,
        values: Vec<SqlValue>,
    ) -> IndexResult<Vec<SourceFileState>> {
        let mut statement = self.connection.prepare(sql)?;
        let rows = statement
            .query_map(params_from_iter(values), source_file_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn require_v8(&self, operation: &str) -> IndexResult<()> {
        if self.layout == IndexLayout::V8 {
            Ok(())
        } else {
            // Single-branch content contract: v7 is an import format only.
            // Content-bearing commands fail closed with the typed upgrade
            // error; the only v7 consumer is the explicit sync migration.
            Err(IndexError::unsupported(
                self.metadata.schema_version,
                format!(
                    "{operation} requires a native v8 index; the legacy v7 index is migrated by an explicit scoped `shlog sync`"
                ),
            ))
        }
    }
}

pub(crate) fn inspect_v8_invariants(connection: &Connection) -> IndexResult<InvariantReport> {
    let mut report = InvariantReport {
        session_count: count(connection, "session_rows", None)?,
        message_document_count: count(connection, "documents", Some("kind='message'"))?,
        profile_document_count: count(connection, "documents", Some("kind='session_profile'"))?,
        fts_row_count: count(connection, "documents_fts", None)?,
        source_file_count: count(connection, "source_files", None)?,
        coverage_count: count(connection, "coverage", None)?,
        violations: Vec::new(),
    };

    collect_foreign_key_violations(connection, &mut report)?;
    let public_session_count = count(connection, "sessions", None)?;
    if public_session_count != report.session_count {
        report.violations.push(format!(
            "sessions compatibility view exposes {public_session_count} rows for {} session_rows",
            report.session_count
        ));
    }
    let mut statement = connection.prepare(
        "SELECT s.id, s.source_id, s.native_session_id, s.session_key, s.message_count, \
         s.document_count, \
         SUM(CASE WHEN d.kind='message' THEN 1 ELSE 0 END), \
         SUM(CASE WHEN d.kind='session_profile' THEN 1 ELSE 0 END), COUNT(d.id), \
         MIN(CASE WHEN d.kind='message' THEN d.seq END), \
         MAX(CASE WHEN d.kind='message' THEN d.seq END) \
         FROM session_rows s LEFT JOIN documents d ON d.session_id=s.id GROUP BY s.id",
    )?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let source: String = row.get(1)?;
        let native: String = row.get(2)?;
        let key: String = row.get(3)?;
        if SourceId::from_str(&source).is_err() {
            report
                .violations
                .push(format!("session {id} has unknown source_id {source:?}"));
        }
        let expected_key = format!("{source}:{native}");
        if key != expected_key {
            report
                .violations
                .push(format!("session {id} has noncanonical session_key"));
        }
        let stored_messages: i64 = row.get(4)?;
        let stored_documents: i64 = row.get(5)?;
        let actual_messages: i64 = row.get(6)?;
        let profiles: i64 = row.get(7)?;
        let actual_documents: i64 = row.get(8)?;
        if stored_messages != actual_messages {
            report.violations.push(format!(
                "session {id} message_count={stored_messages}, documents={actual_messages}"
            ));
        }
        if stored_documents != actual_documents {
            report.violations.push(format!(
                "session {id} document_count={stored_documents}, documents={actual_documents}"
            ));
        }
        if profiles != 1 {
            report
                .violations
                .push(format!("session {id} has {profiles} profile documents"));
        }
        if actual_messages > 0 {
            let minimum: Option<i64> = row.get(9)?;
            let maximum: Option<i64> = row.get(10)?;
            if minimum != Some(0) || maximum != Some(actual_messages - 1) {
                report.violations.push(format!(
                    "session {id} message seq is not contiguous from zero"
                ));
            }
        }
    }

    if report.fts_row_count != report.message_document_count + report.profile_document_count {
        report.violations.push(format!(
            "documents_fts has {} rows for {} documents",
            report.fts_row_count,
            report.message_document_count + report.profile_document_count
        ));
    }
    let missing_fts: i64 = connection.query_row(
        "SELECT COUNT(*) FROM documents d LEFT JOIN documents_fts f ON f.rowid=d.id \
         WHERE f.rowid IS NULL",
        [],
        |row| row.get(0),
    )?;
    if missing_fts != 0 {
        report
            .violations
            .push(format!("{missing_fts} documents have no FTS row"));
    }
    let invalid_cursor: i64 = connection.query_row(
        "SELECT COUNT(*) FROM source_files \
         WHERE indexed_bytes>size OR next_seq<0 OR \
         (indexed_bytes>0 AND (head_digest='' OR boundary_digest=''))",
        [],
        |row| row.get(0),
    )?;
    if invalid_cursor != 0 {
        report.violations.push(format!(
            "{invalid_cursor} source_files have invalid append cursors"
        ));
    }
    let stale_cursor: i64 = connection.query_row(
        "SELECT COUNT(*) FROM source_files sf JOIN session_rows s ON s.id=sf.session_id \
         WHERE sf.indexed_bytes>0 AND sf.next_seq<>s.message_count",
        [],
        |row| row.get(0),
    )?;
    if stale_cursor != 0 {
        report
            .violations
            .push(format!("{stale_cursor} source_files have stale next_seq"));
    }
    validate_profile_mirrors(connection, &mut report)?;
    validate_coverage_json(connection, &mut report)?;
    Ok(report)
}

fn validate_profile_mirrors(
    connection: &Connection,
    report: &mut InvariantReport,
) -> IndexResult<()> {
    let mismatches: i64 = connection.query_row(
        "SELECT COUNT(*) FROM session_rows s JOIN documents d ON d.session_id=s.id \
         WHERE d.kind='session_profile' AND (d.title_text<>s.title OR \
         d.summary_text<>s.summary_text OR d.compact_text<>s.compact_text OR \
         d.reasoning_text<>s.reasoning_summary_text)",
        [],
        |row| row.get(0),
    )?;
    if mismatches != 0 {
        report.violations.push(format!(
            "{mismatches} session profiles disagree with stable session columns"
        ));
    }
    Ok(())
}

fn validate_coverage_json(
    connection: &Connection,
    report: &mut InvariantReport,
) -> IndexResult<()> {
    let mut statement =
        connection.prepare("SELECT id, source_id, selector_json, selector_key FROM coverage")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let source: String = row.get(1)?;
        let json: String = row.get(2)?;
        let key: String = row.get(3)?;
        match selector_from_json(&json, &source) {
            Ok(selector) => {
                if selector.source().as_str() != source {
                    report
                        .violations
                        .push(format!("coverage {id} source_id disagrees with selector"));
                }
                if selector.storage_key() != key {
                    report
                        .violations
                        .push(format!("coverage {id} selector_key is not canonical"));
                }
            }
            Err(error) => report
                .violations
                .push(format!("coverage {id} selector JSON: {error}")),
        }
    }
    Ok(())
}

fn collect_foreign_key_violations(
    connection: &Connection,
    report: &mut InvariantReport,
) -> IndexResult<()> {
    let mut statement = connection.prepare("PRAGMA foreign_key_check")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let table: String = row.get(0)?;
        let rowid: Option<i64> = row.get(1)?;
        report
            .violations
            .push(format!("foreign key violation in {table} row {rowid:?}"));
    }
    Ok(())
}

fn count(connection: &Connection, table: &str, predicate: Option<&str>) -> IndexResult<u64> {
    let sql = match predicate {
        Some(predicate) => format!("SELECT COUNT(*) FROM {table} WHERE {predicate}"),
        None => format!("SELECT COUNT(*) FROM {table}"),
    };
    let value: i64 = connection.query_row(&sql, [], |row| row.get(0))?;
    non_negative(value, "row count").map_err(Into::into)
}

fn stored_session_from_row(row: &Row<'_>) -> rusqlite::Result<StoredSession> {
    let source_text: String = row.get(1)?;
    let source_id = parse_source(&source_text)?;
    Ok(StoredSession {
        id: row.get(0)?,
        identity: SessionIdentity {
            source_id,
            native_session_id: row.get(2)?,
            session_key: row.get(3)?,
        },
        session_uuid: row.get(4)?,
        file_path: row.get(5)?,
        source_root: row.get(6)?,
        title: row.get(7)?,
        summary_text: row.get(8)?,
        compact_text: row.get(9)?,
        reasoning_summary_text: row.get(10)?,
        cwd: row.get(11)?,
        model: row.get(12)?,
        started_at: row.get(13)?,
        ended_at: row.get(14)?,
        path_date: row.get(15)?,
        message_count: non_negative(row.get::<_, i64>(16)?, "message count")?,
        document_count: non_negative(row.get::<_, i64>(17)?, "document count")?,
        raw_file_mtime: row.get(18)?,
        raw_file_size: non_negative(row.get::<_, i64>(19)?, "raw file size")?,
        index_version: row.get(20)?,
        updated_at: row.get(21)?,
    })
}

fn public_session(session: &StoredSession) -> SessionRecord {
    SessionRecord {
        id: session.id,
        source_id: session.identity.source_id,
        native_session_id: session.identity.native_session_id.clone(),
        session_key: session.identity.session_key.clone(),
        session_uuid: session.session_uuid.clone(),
        file_path: session.file_path.clone(),
        source_root: session.source_root.clone(),
        title: session.title.clone(),
        summary_text: session.summary_text.clone(),
        compact_text: session.compact_text.clone(),
        reasoning_summary_text: session.reasoning_summary_text.clone(),
        cwd: session.cwd.clone(),
        model: session.model.clone(),
        started_at: session.started_at.clone(),
        ended_at: session.ended_at.clone(),
        path_date: session.path_date.clone(),
        message_count: session.message_count,
    }
}

fn message_from_row(row: &Row<'_>) -> rusqlite::Result<MessageRecord> {
    Ok(MessageRecord {
        session_uuid: row.get(0)?,
        seq: row.get(1)?,
        role: parse_role(&row.get::<_, String>(2)?)?,
        content_text: row.get(3)?,
        timestamp: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        source_kind: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        elision: None,
    })
}

fn coverage_from_row(row: &Row<'_>) -> rusqlite::Result<CoverageRecord> {
    let source: String = row.get(1)?;
    let selector_json: String = row.get(2)?;
    Ok(CoverageRecord {
        id: row.get(0)?,
        selector: selector_from_json(&selector_json, &source)?,
        source_fingerprint: row.get(3)?,
        source_file_set_fingerprint: row.get(4)?,
        source_file_count: non_negative(row.get::<_, i64>(5)?, "coverage file count")?,
        indexed_session_count: non_negative(row.get::<_, i64>(6)?, "coverage session count")?,
        completed_at: row.get(7)?,
        index_version: row.get(8)?,
    })
}

fn stored_document_from_row(row: &Row<'_>) -> rusqlite::Result<StoredDocument> {
    let kind_text: String = row.get(1)?;
    let kind = DocumentKind::parse(&kind_text)
        .ok_or_else(|| conversion_error(format!("unknown document kind {kind_text:?}")))?;
    let role = row
        .get::<_, Option<String>>(3)?
        .map(|value| parse_role(&value))
        .transpose()?;
    Ok(StoredDocument {
        id: Some(row.get(0)?),
        kind,
        seq: row.get(2)?,
        role,
        timestamp: row.get(4)?,
        source_kind: row.get(5)?,
        body_text: row.get(6)?,
        title_text: row.get(7)?,
        summary_text: row.get(8)?,
        compact_text: row.get(9)?,
        reasoning_text: row.get(10)?,
        raw_start: optional_non_negative(row.get(11)?, "raw_start")?,
        raw_end: optional_non_negative(row.get(12)?, "raw_end")?,
        projection_epoch: row.get(13)?,
    })
}

fn candidate_v8_from_row(row: &Row<'_>) -> rusqlite::Result<CandidateEvidence> {
    let kind_text: String = row.get(13)?;
    let kind = DocumentKind::parse(&kind_text)
        .ok_or_else(|| conversion_error(format!("unknown document kind {kind_text:?}")))?;
    Ok(CandidateEvidence {
        document_id: row.get(0)?,
        session_id: row.get(1)?,
        source_id: parse_source(&row.get::<_, String>(2)?)?,
        session_key: row.get(3)?,
        session_uuid: row.get(4)?,
        title: row.get(5)?,
        summary_text: row.get(6)?,
        compact_text: row.get(7)?,
        reasoning_summary_text: row.get(8)?,
        cwd: row.get(9)?,
        started_at: row.get(10)?,
        ended_at: row.get(11)?,
        session_message_count: non_negative(row.get::<_, i64>(12)?, "message count")?,
        kind,
        seq: row.get(14)?,
        role: row
            .get::<_, Option<String>>(15)?
            .map(|value| parse_role(&value))
            .transpose()?,
        timestamp: row.get(16)?,
        body_text: row.get(17)?,
        raw_start: optional_non_negative(row.get(18)?, "raw_start")?,
        raw_end: optional_non_negative(row.get(19)?, "raw_end")?,
        fts_score: row.get(20)?,
    })
}

fn source_file_select() -> &'static str {
    "SELECT sf.source_id, sf.file_path, sf.source_root, sf.source_generation, \
     sf.mtime_ms, sf.mtime_ns, sf.size, sf.indexed_bytes, sf.head_digest, sf.boundary_digest, \
     sf.next_seq, sf.reducer_checkpoint, sf.cwd, sf.path_date, sf.extra_fingerprint, \
     sf.projection_epoch, sf.analyzer_epoch, sf.coverage_epoch, \
     s.source_id, s.native_session_id, s.session_key \
     FROM source_files sf LEFT JOIN sessions s ON s.id=sf.session_id"
}

fn source_file_from_row(row: &Row<'_>) -> rusqlite::Result<SourceFileState> {
    let source_id = parse_source(&row.get::<_, String>(0)?)?;
    let linked_source = row.get::<_, Option<String>>(18)?;
    let session = match linked_source {
        Some(linked_source) => Some(SessionIdentity {
            source_id: parse_source(&linked_source)?,
            native_session_id: row.get::<_, Option<String>>(19)?.ok_or_else(|| {
                conversion_error("linked source_file native_session_id is null".to_owned())
            })?,
            session_key: row.get::<_, Option<String>>(20)?.ok_or_else(|| {
                conversion_error("linked source_file session_key is null".to_owned())
            })?,
        }),
        None => None,
    };
    Ok(SourceFileState {
        source_id,
        file_path: row.get(1)?,
        source_root: row.get(2)?,
        source_generation: row.get(3)?,
        mtime_ms: row.get(4)?,
        mtime_ns: row.get(5)?,
        size: non_negative(row.get::<_, i64>(6)?, "source file size")?,
        indexed_bytes: non_negative(row.get::<_, i64>(7)?, "indexed bytes")?,
        head_digest: row.get(8)?,
        boundary_digest: row.get(9)?,
        next_seq: row.get(10)?,
        reducer_checkpoint: row.get(11)?,
        cwd: row.get(12)?,
        path_date: row.get(13)?,
        extra_fingerprint: row.get(14)?,
        projection_epoch: row.get(15)?,
        analyzer_epoch: row.get(16)?,
        coverage_epoch: row.get(17)?,
        session,
    })
}

fn add_recall_scope(
    conditions: &mut Vec<String>,
    values: &mut Vec<SqlValue>,
    spec: &RecallSpec,
    alias: &str,
) -> IndexResult<()> {
    if let Some(session) = &spec.session {
        conditions.push(format!("{alias}.source_id=?"));
        values.push(sql_text(session.source_id.as_str()));
        conditions.push(format!("{alias}.native_session_id=?"));
        values.push(sql_text(&session.native_session_id));
        if let Some(selector) = &spec.selector {
            add_selector_filter(conditions, values, selector, alias)?;
        }
    } else if let Some(selector) = &spec.selector {
        add_selector_filter(conditions, values, selector, alias)?;
    } else if !spec.sources.is_empty() {
        conditions.push(format!(
            "{alias}.source_id IN ({})",
            vec!["?"; spec.sources.len()].join(",")
        ));
        values.extend(spec.sources.iter().map(|source| sql_text(source.as_str())));
    }
    let mut excluded = spec
        .excluded_session_uuids
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    excluded.sort_unstable();
    excluded.dedup();
    if !excluded.is_empty() {
        conditions.push(format!(
            "{alias}.session_uuid NOT IN ({})",
            vec!["?"; excluded.len()].join(",")
        ));
        values.extend(excluded.into_iter().map(sql_text));
    }
    Ok(())
}

fn add_selector_filter(
    conditions: &mut Vec<String>,
    values: &mut Vec<SqlValue>,
    selector: &Selector,
    alias: &str,
) -> IndexResult<()> {
    if !alias
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || value == '_')
    {
        return Err(IndexError::InvalidOperation("invalid SQL alias".to_owned()));
    }
    conditions.push(format!("{alias}.source_id=?"));
    values.push(sql_text(selector.source().as_str()));
    conditions.push(format!(
        "({alias}.file_path=? OR {alias}.file_path LIKE ? ESCAPE '\\')"
    ));
    values.push(sql_text(selector.root()));
    values.push(descendant_like_pattern(selector.root()).into());
    match selector {
        Selector::All { .. } => {}
        Selector::DateRange {
            from_date, to_date, ..
        } => {
            conditions.push(format!("{alias}.path_date>=?"));
            conditions.push(format!("{alias}.path_date<=?"));
            values.push(sql_text(from_date));
            values.push(sql_text(to_date));
        }
        Selector::Cwd { cwd, .. } => {
            conditions.push(format!("{alias}.cwd=?"));
            values.push(sql_text(cwd));
        }
        Selector::CwdDateRange {
            cwd,
            from_date,
            to_date,
            ..
        } => {
            conditions.push(format!("{alias}.cwd=?"));
            conditions.push(format!("{alias}.path_date>=?"));
            conditions.push(format!("{alias}.path_date<=?"));
            values.push(sql_text(cwd));
            values.push(sql_text(from_date));
            values.push(sql_text(to_date));
        }
    }
    Ok(())
}

fn recall_order_sql(
    order: RecallOrder,
    relevance: &str,
    session: &str,
    document: Option<&str>,
) -> String {
    match order {
        RecallOrder::Ended => format!("{session}.ended_at DESC, {relevance}"),
        RecallOrder::Started => format!("{session}.started_at DESC, {relevance}"),
        RecallOrder::Relevance => match document {
            Some(document) => {
                format!("{relevance}, {session}.ended_at DESC, COALESCE({document}.seq, -1) ASC")
            }
            None => relevance.to_owned(),
        },
    }
}

fn fts_match(terms: &[String]) -> String {
    terms
        .iter()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn selector_from_json(json: &str, source: &str) -> rusqlite::Result<Selector> {
    let mut value: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| conversion_error(format!("invalid selector JSON: {error}")))?;
    if let Some(object) = value.as_object_mut() {
        object
            .entry("source")
            .or_insert_with(|| serde_json::Value::String(source.to_owned()));
    }
    serde_json::from_value(value)
        .map_err(|error| conversion_error(format!("invalid selector shape: {error}")))
}

fn parse_source(value: &str) -> rusqlite::Result<SourceId> {
    SourceId::from_str(value).map_err(|_| conversion_error(format!("unknown source_id {value:?}")))
}

fn parse_role(value: &str) -> rusqlite::Result<MessageRole> {
    match value {
        "user" => Ok(MessageRole::User),
        "assistant" => Ok(MessageRole::Assistant),
        _ => Err(conversion_error(format!("unknown message role {value:?}"))),
    }
}

fn conversion_error(message: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(IndexError::InvalidData(message)),
    )
}

fn non_negative(value: i64, field: &str) -> rusqlite::Result<u64> {
    u64::try_from(value).map_err(|_| conversion_error(format!("{field} is negative: {value}")))
}

fn optional_non_negative(value: Option<i64>, field: &str) -> rusqlite::Result<Option<u64>> {
    value.map(|value| non_negative(value, field)).transpose()
}

fn to_i64(value: u64, field: &str) -> IndexResult<i64> {
    i64::try_from(value)
        .map_err(|_| IndexError::InvalidOperation(format!("{field} exceeds SQLite INTEGER range")))
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn descendant_like_pattern(root: &str) -> String {
    let mut prefix = root.to_owned();
    if !prefix.ends_with(std::path::MAIN_SEPARATOR) {
        prefix.push(std::path::MAIN_SEPARATOR);
    }
    format!("{}%", escape_like(&prefix))
}

fn sql_text(value: &str) -> SqlValue {
    SqlValue::Text(value.to_owned())
}

fn session_root_from_file(file_path: &str) -> String {
    if let Some(index) = file_path.find("/sessions/") {
        return file_path[..index + "/sessions".len()].to_owned();
    }
    Path::new(file_path)
        .parent()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default()
}
