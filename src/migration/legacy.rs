use std::collections::HashSet;
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use blake3::Hasher;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags, OptionalExtension, Row};

use crate::cold::ColdRootEntry;
use crate::config::INDEX_VERSION;
use crate::identity::{SessionIdentity, SourceId};
use crate::index::{
    ANALYZER_EPOCH, COVERAGE_EPOCH, CommitReceipt, IndexWriter, MessageWrite, PROJECTION_EPOCH,
    SessionWrite, SourceFileState,
};
use crate::model::MessageRole;

use super::error::{MigrationError, MigrationResult};

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct V7Fingerprint {
    pub digest: String,
    pub session_count: u64,
    pub message_count: u64,
    pub source_file_count: u64,
    pub coverage_count: u64,
}

impl V7Fingerprint {
    /// A stable marker is mixed into the digest instead of an absent column
    /// value, so a legacy table without the column and one storing explicit
    /// NULLs never produce the same fingerprint.
    fn update_coverage_digest_marker(hasher: &mut Hasher, has_set_fingerprint: bool) {
        if has_set_fingerprint {
            hasher.update(b"COV14");
        } else {
            hasher.update(b"COV13");
        }
    }
}

#[derive(Debug)]
pub(super) struct CopyOutcome {
    pub receipt: CommitReceipt,
    pub source: V7Fingerprint,
    pub cold_root_count: u64,
}

pub(super) enum SourceLayout {
    V7,
    V8,
    Unsupported(String),
}

pub(super) fn inspect_source_layout(path: &Path) -> MigrationResult<SourceLayout> {
    if !path.exists() {
        return Err(MigrationError::NotFound(path.to_path_buf()));
    }
    let connection = open_read_only(path)?;
    let user_version: i64 =
        connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let sessions = table_exists(&connection, "sessions")?;
    let messages = table_exists(&connection, "messages")?;
    let documents = table_exists(&connection, "documents")?;
    let meta = table_exists(&connection, "meta")?;
    let session_rows = table_exists(&connection, "session_rows")?;
    let sessions_object = schema_object_type(&connection, "sessions")?;
    if user_version == 8 {
        if session_rows && sessions_object.as_deref() == Some("view") && documents && meta {
            return Ok(SourceLayout::V8);
        }
        return Ok(SourceLayout::Unsupported(
            "user_version=8 requires session_rows/documents/meta tables and a sessions view"
                .to_owned(),
        ));
    }
    if user_version > 8 {
        return Ok(SourceLayout::Unsupported(format!(
            "user_version={user_version} is newer than this migrator"
        )));
    }
    if sessions && messages {
        for column in ["source_id", "native_session_id", "session_key"] {
            if !column_exists(&connection, "sessions", column)? {
                return Ok(SourceLayout::Unsupported(format!(
                    "v7 sessions.{column} is missing"
                )));
            }
        }
        return Ok(SourceLayout::V7);
    }
    Ok(SourceLayout::Unsupported(format!(
        "user_version={user_version}; expected v7 sessions/messages"
    )))
}

/// Fail closed before copying any bytes from a corrupt or referentially
/// inconsistent legacy database. In particular, fingerprint queries join
/// messages to sessions; without the raw-vs-joined count check an orphaned
/// message could otherwise disappear silently.
pub(super) fn preflight_v7(path: &Path) -> MigrationResult<()> {
    let connection = open_read_only(path)?;
    let mut integrity_statement = connection.prepare("PRAGMA integrity_check")?;
    let integrity_rows = integrity_statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    if integrity_rows.as_slice() != ["ok"] {
        return Err(MigrationError::InvalidV7(format!(
            "{} integrity_check failed: {integrity_rows:?}",
            path.display()
        )));
    }
    let foreign_key_violation = connection
        .query_row("PRAGMA foreign_key_check", [], |_| Ok(()))
        .optional()?;
    if foreign_key_violation.is_some() {
        return Err(MigrationError::InvalidV7(format!(
            "{} foreign_key_check found a violation",
            path.display()
        )));
    }
    let raw_messages: i64 =
        connection.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?;
    let joined_messages: i64 = connection.query_row(
        "SELECT COUNT(*) FROM messages m JOIN sessions s ON s.id=m.session_id",
        [],
        |row| row.get(0),
    )?;
    if raw_messages < 0 || raw_messages != joined_messages {
        return Err(MigrationError::InvalidV7(format!(
            "{} contains orphaned messages: raw={raw_messages} joined={joined_messages}",
            path.display()
        )));
    }
    Ok(())
}

pub(super) fn fingerprint_v7(path: &Path) -> MigrationResult<V7Fingerprint> {
    let connection = open_read_only(path)?;
    let mut hasher = Hasher::new();
    let session_count = hash_query(
        &connection,
        &mut hasher,
        "sessions",
        "SELECT source_id, native_session_id, session_key, session_uuid, file_path, \
                source_root, title, summary_text, compact_text, reasoning_summary_text, \
                cwd, model, started_at, ended_at, path_date, message_count, \
                raw_file_mtime, raw_file_size, index_version \
         FROM sessions ORDER BY source_id, native_session_id",
    )?;
    let message_count = hash_query(
        &connection,
        &mut hasher,
        "messages",
        "SELECT s.source_id, s.native_session_id, m.seq, m.role, m.content_text, \
                m.timestamp, m.source_kind, m.session_uuid \
         FROM messages m JOIN sessions s ON s.id=m.session_id \
         ORDER BY s.source_id, s.native_session_id, m.seq",
    )?;
    let source_file_count = if table_exists(&connection, "source_file_meta_cache")? {
        hash_query(
            &connection,
            &mut hasher,
            "source_file_meta_cache",
            "SELECT source_id, file_path, mtime_ms, size, cwd, path_date, \
                    extra_fingerprint \
             FROM source_file_meta_cache ORDER BY source_id, file_path",
        )?
    } else {
        hash_missing_table(&mut hasher, "source_file_meta_cache");
        0
    };
    // The coverage table is only fingerprinted here, never copied: v8 starts
    // with coverage cleared. The `source_file_set_fingerprint` column was
    // added by 0.4.4 without bumping `INDEX_VERSION`, so real v7 databases
    // exist in both 13- and 14-column shapes under the same version string.
    // Probe the column instead of assuming it, or the fingerprint query fails
    // with `no such column` and the whole migration aborts.
    let coverage_count = if table_exists(&connection, "coverage")? {
        let has_set_fingerprint =
            column_exists(&connection, "coverage", "source_file_set_fingerprint")?;
        let sql = if has_set_fingerprint {
            "SELECT source_id, selector_key, selector_json, selector_kind, root, cwd, \
                    from_date, to_date, source_fingerprint, source_file_set_fingerprint, \
                    source_file_count, indexed_session_count, completed_at, index_version \
             FROM coverage ORDER BY selector_key"
        } else {
            "SELECT source_id, selector_key, selector_json, selector_kind, root, cwd, \
                    from_date, to_date, source_fingerprint, source_file_count, \
                    indexed_session_count, completed_at, index_version \
             FROM coverage ORDER BY selector_key"
        };
        V7Fingerprint::update_coverage_digest_marker(&mut hasher, has_set_fingerprint);
        hash_query(&connection, &mut hasher, "coverage", sql)?
    } else {
        V7Fingerprint::update_coverage_digest_marker(&mut hasher, false);
        hash_missing_table(&mut hasher, "coverage");
        0
    };

    Ok(V7Fingerprint {
        digest: hasher.finalize().to_hex().to_string(),
        session_count,
        message_count,
        source_file_count,
        coverage_count,
    })
}

pub(super) fn copy_v7_projection(
    source_path: &Path,
    writer: &mut IndexWriter,
    cold_roots: &[ColdRootEntry],
) -> MigrationResult<CopyOutcome> {
    let source = fingerprint_v7(source_path)?;
    let connection = open_read_only(source_path)?;
    connection.execute_batch("BEGIN")?;
    let mut transaction = writer.begin()?;

    let mut session_statement = connection.prepare(
        "SELECT id, source_id, native_session_id, session_key, session_uuid, file_path, \
                source_root, title, summary_text, compact_text, reasoning_summary_text, \
                cwd, model, started_at, ended_at, path_date, message_count, \
                raw_file_mtime, raw_file_size \
         FROM sessions ORDER BY source_id, native_session_id",
    )?;
    let mut message_statement = connection.prepare(
        "SELECT seq, role, content_text, timestamp, source_kind, session_uuid \
         FROM messages WHERE session_id=? ORDER BY seq",
    )?;
    let sessions = session_statement.query_map([], V7SessionRow::read)?;
    let mut copied_sessions = 0_u64;
    let mut copied_messages = 0_u64;
    for row in sessions {
        let row = row?;
        let source_id = parse_source(&row.source_id)?;
        let canonical_identity = SessionIdentity::new(source_id, row.native_session_id.clone());
        if row.session_key != canonical_identity.session_key {
            return Err(MigrationError::InvalidV7(format!(
                "non-canonical session_key {:?}; expected {:?}",
                row.session_key, canonical_identity.session_key
            )));
        }
        let raw_file_mtime = integer_mtime(row.raw_file_mtime, &row.session_key)?;
        let raw_file_size = non_negative_u64(row.raw_file_size, "session raw_file_size")?;
        let session = SessionWrite {
            identity: canonical_identity,
            session_uuid: row.session_uuid.clone(),
            file_path: row.file_path,
            source_root: row.source_root,
            title: row.title,
            summary_text: row.summary_text,
            compact_text: row.compact_text,
            reasoning_summary_text: row.reasoning_summary_text,
            cwd: row.cwd,
            model: row.model,
            started_at: row.started_at,
            ended_at: row.ended_at,
            path_date: row.path_date,
            raw_file_mtime,
            raw_file_size,
            index_version: INDEX_VERSION.to_owned(),
        };

        let messages = message_statement
            .query_map([row.id], V7MessageRow::read)?
            .map(|message| to_message(message?, &row.session_uuid))
            .collect::<MigrationResult<Vec<_>>>()?;
        if row.message_count != i64::try_from(messages.len()).unwrap_or(i64::MAX) {
            return Err(MigrationError::InvalidV7(format!(
                "session {} declares {} messages but stores {}",
                row.session_key,
                row.message_count,
                messages.len()
            )));
        }
        transaction.replace_session(&session, &messages)?;
        copied_sessions += 1;
        copied_messages = copied_messages
            .checked_add(messages.len() as u64)
            .ok_or_else(|| MigrationError::InvalidV7("message count overflow".to_owned()))?;
    }
    drop(message_statement);
    drop(session_statement);

    if copied_sessions != source.session_count || copied_messages != source.message_count {
        return Err(MigrationError::Verification(format!(
            "copy count drift: source={}/{} copied={copied_sessions}/{copied_messages}",
            source.session_count, source.message_count
        )));
    }

    if table_exists(&connection, "source_file_meta_cache")? {
        copy_source_file_cache(&connection, &mut transaction)?;
    }

    let mut imported_cold_roots = HashSet::new();
    for entry in cold_roots {
        let source_id = parse_source(&entry.source_id)?;
        if !imported_cold_roots.insert((source_id, entry.root.clone())) {
            continue;
        }
        transaction.upsert_cold_root(source_id, &entry.root, Some(&entry.added_at))?;
    }

    let receipt = transaction.commit()?;
    connection.execute_batch("COMMIT")?;
    Ok(CopyOutcome {
        receipt,
        source,
        cold_root_count: imported_cold_roots.len() as u64,
    })
}

fn copy_source_file_cache(
    connection: &Connection,
    transaction: &mut crate::index::IndexTransaction<'_>,
) -> MigrationResult<()> {
    let mut statement = connection.prepare(
        "SELECT c.source_id, c.file_path, c.mtime_ms, c.size, c.cwd, c.path_date, \
                c.extra_fingerprint, s.native_session_id, s.session_key, s.source_root \
         FROM source_file_meta_cache c \
         LEFT JOIN sessions s ON s.source_id=c.source_id AND s.file_path=c.file_path \
         ORDER BY c.source_id, c.file_path",
    )?;
    let rows = statement.query_map([], V7SourceFileRow::read)?;
    for row in rows {
        let row = row?;
        let source_id = parse_source(&row.source_id)?;
        if !row.mtime_ms.is_finite() || row.mtime_ms < 0.0 {
            return Err(MigrationError::InvalidV7(format!(
                "source file {} has invalid mtime_ms {}",
                row.file_path, row.mtime_ms
            )));
        }
        let session = match (row.native_session_id, row.session_key) {
            (Some(native), Some(stored_key)) => {
                let identity = SessionIdentity::new(source_id, native);
                if stored_key != identity.session_key {
                    return Err(MigrationError::InvalidV7(format!(
                        "source file {} links non-canonical session key {stored_key:?}",
                        row.file_path
                    )));
                }
                Some(identity)
            }
            (None, None) => None,
            _ => {
                return Err(MigrationError::InvalidV7(format!(
                    "source file {} has a partial session identity",
                    row.file_path
                )));
            }
        };
        transaction.upsert_source_file(&SourceFileState {
            source_id,
            file_path: row.file_path,
            source_root: row.source_root.unwrap_or_default(),
            source_generation: String::new(),
            mtime_ms: row.mtime_ms,
            // V7 stored mtime as a REAL millisecond value. It cannot prove an
            // exact nanosecond timestamp, so force a cache miss on the first
            // v8 hot sync instead of manufacturing precision.
            mtime_ns: None,
            size: non_negative_u64(row.size, "source file size")?,
            // V7 proves neither a byte boundary nor an append prefix. The next
            // hot sync must full-parse before establishing a cursor.
            indexed_bytes: 0,
            head_digest: String::new(),
            boundary_digest: String::new(),
            next_seq: 0,
            reducer_checkpoint: None,
            cwd: row.cwd,
            path_date: row.path_date,
            extra_fingerprint: row.extra_fingerprint,
            projection_epoch: PROJECTION_EPOCH,
            analyzer_epoch: ANALYZER_EPOCH,
            coverage_epoch: COVERAGE_EPOCH,
            session,
        })?;
    }
    Ok(())
}

fn to_message(row: V7MessageRow, expected_session_uuid: &str) -> MigrationResult<MessageWrite> {
    if row.session_uuid != expected_session_uuid {
        return Err(MigrationError::InvalidV7(format!(
            "message seq {} belongs to UUID {:?}, expected {:?}",
            row.seq, row.session_uuid, expected_session_uuid
        )));
    }
    let role = match row.role.as_str() {
        "user" => MessageRole::User,
        "assistant" => MessageRole::Assistant,
        value => {
            return Err(MigrationError::InvalidV7(format!(
                "message seq {} has rejected role {value:?}",
                row.seq
            )));
        }
    };
    Ok(MessageWrite {
        seq: row.seq,
        role,
        timestamp: row.timestamp,
        source_kind: row.source_kind,
        body_text: row.content_text,
        raw_start: None,
        raw_end: None,
        projection_epoch: PROJECTION_EPOCH,
    })
}

fn parse_source(value: &str) -> MigrationResult<SourceId> {
    SourceId::from_str(value)
        .map_err(|_| MigrationError::InvalidV7(format!("unsupported stored source_id {value:?}")))
}

fn integer_mtime(value: f64, session_key: &str) -> MigrationResult<i64> {
    if !value.is_finite() || value < i64::MIN as f64 || value > i64::MAX as f64 {
        return Err(MigrationError::InvalidV7(format!(
            "session {session_key} has invalid raw_file_mtime {value}"
        )));
    }
    Ok(value.round() as i64)
}

fn non_negative_u64(value: i64, field: &str) -> MigrationResult<u64> {
    u64::try_from(value)
        .map_err(|_| MigrationError::InvalidV7(format!("{field} is negative: {value}")))
}

fn open_read_only(path: &Path) -> MigrationResult<Connection> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.busy_timeout(BUSY_TIMEOUT)?;
    connection.pragma_update(None, "query_only", "ON")?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    Ok(connection)
}

fn table_exists(connection: &Connection, table: &str) -> MigrationResult<bool> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
            [table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn schema_object_type(connection: &Connection, name: &str) -> MigrationResult<Option<String>> {
    Ok(connection
        .query_row(
            "SELECT type FROM sqlite_master WHERE name=? LIMIT 1",
            [name],
            |row| row.get(0),
        )
        .optional()?)
}

fn column_exists(connection: &Connection, table: &str, column: &str) -> MigrationResult<bool> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        if row.get::<_, String>(1)? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn hash_query(
    connection: &Connection,
    hasher: &mut Hasher,
    label: &str,
    sql: &str,
) -> MigrationResult<u64> {
    hash_bytes(hasher, label.as_bytes());
    let mut statement = connection.prepare(sql)?;
    let column_count = statement.column_count();
    let mut rows = statement.query([])?;
    let mut count = 0_u64;
    while let Some(row) = rows.next()? {
        hasher.update(b"R");
        for index in 0..column_count {
            hash_value(hasher, row.get_ref(index)?);
        }
        count += 1;
    }
    hasher.update(&count.to_le_bytes());
    Ok(count)
}

fn hash_missing_table(hasher: &mut Hasher, label: &str) {
    hash_bytes(hasher, label.as_bytes());
    hasher.update(b"MISSING");
}

fn hash_value(hasher: &mut Hasher, value: ValueRef<'_>) {
    match value {
        ValueRef::Null => {
            hasher.update(b"N");
        }
        ValueRef::Integer(value) => {
            hasher.update(b"I");
            hasher.update(&value.to_le_bytes());
        }
        ValueRef::Real(value) => {
            hasher.update(b"F");
            hasher.update(&value.to_bits().to_le_bytes());
        }
        ValueRef::Text(value) => {
            hasher.update(b"T");
            hash_bytes(hasher, value);
        }
        ValueRef::Blob(value) => {
            hasher.update(b"B");
            hash_bytes(hasher, value);
        }
    }
}

fn hash_bytes(hasher: &mut Hasher, value: &[u8]) {
    hasher.update(&(value.len() as u64).to_le_bytes());
    hasher.update(value);
}

/// Legacy v7 TEXT columns can contain bytes that are not valid UTF-8 (e.g.
/// lone UTF-16 surrogates persisted by old JavaScript writers). The import
/// path normalizes them lossily to U+FFFD instead of failing the whole
/// migration on one drifted cell.
fn legacy_text(row: &Row<'_>, index: usize) -> rusqlite::Result<String> {
    Ok(match row.get_ref(index)? {
        rusqlite::types::ValueRef::Text(bytes) | rusqlite::types::ValueRef::Blob(bytes) => {
            String::from_utf8_lossy(bytes).into_owned()
        }
        value => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                index,
                value.data_type(),
                "text".into(),
            ));
        }
    })
}

fn legacy_optional_text(row: &Row<'_>, index: usize) -> rusqlite::Result<Option<String>> {
    Ok(match row.get_ref(index)? {
        rusqlite::types::ValueRef::Null => None,
        rusqlite::types::ValueRef::Text(bytes) | rusqlite::types::ValueRef::Blob(bytes) => {
            Some(String::from_utf8_lossy(bytes).into_owned())
        }
        value => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                index,
                value.data_type(),
                "text".into(),
            ));
        }
    })
}

struct V7SessionRow {
    id: i64,
    source_id: String,
    native_session_id: String,
    session_key: String,
    session_uuid: String,
    file_path: String,
    source_root: String,
    title: String,
    summary_text: String,
    compact_text: String,
    reasoning_summary_text: String,
    cwd: String,
    model: String,
    started_at: String,
    ended_at: String,
    path_date: String,
    message_count: i64,
    raw_file_mtime: f64,
    raw_file_size: i64,
}

impl V7SessionRow {
    fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            source_id: legacy_text(row, 1)?,
            native_session_id: legacy_text(row, 2)?,
            session_key: legacy_text(row, 3)?,
            session_uuid: legacy_text(row, 4)?,
            file_path: legacy_text(row, 5)?,
            source_root: legacy_text(row, 6)?,
            title: legacy_text(row, 7)?,
            summary_text: legacy_text(row, 8)?,
            compact_text: legacy_text(row, 9)?,
            reasoning_summary_text: legacy_text(row, 10)?,
            cwd: legacy_text(row, 11)?,
            model: legacy_text(row, 12)?,
            started_at: legacy_text(row, 13)?,
            ended_at: legacy_text(row, 14)?,
            path_date: legacy_text(row, 15)?,
            message_count: row.get(16)?,
            raw_file_mtime: row.get(17)?,
            raw_file_size: row.get(18)?,
        })
    }
}

struct V7MessageRow {
    seq: i64,
    role: String,
    content_text: String,
    timestamp: String,
    source_kind: String,
    session_uuid: String,
}

impl V7MessageRow {
    fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            seq: row.get(0)?,
            role: legacy_text(row, 1)?,
            content_text: legacy_text(row, 2)?,
            timestamp: legacy_text(row, 3)?,
            source_kind: legacy_text(row, 4)?,
            session_uuid: legacy_text(row, 5)?,
        })
    }
}

struct V7SourceFileRow {
    source_id: String,
    file_path: String,
    mtime_ms: f64,
    size: i64,
    cwd: String,
    path_date: Option<String>,
    extra_fingerprint: String,
    native_session_id: Option<String>,
    session_key: Option<String>,
    source_root: Option<String>,
}

impl V7SourceFileRow {
    fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            source_id: legacy_text(row, 0)?,
            file_path: legacy_text(row, 1)?,
            mtime_ms: row.get(2)?,
            size: row.get(3)?,
            cwd: legacy_text(row, 4)?,
            path_date: legacy_optional_text(row, 5)?,
            extra_fingerprint: legacy_text(row, 6)?,
            native_session_id: legacy_optional_text(row, 7)?,
            session_key: legacy_optional_text(row, 8)?,
            source_root: legacy_optional_text(row, 9)?,
        })
    }
}
