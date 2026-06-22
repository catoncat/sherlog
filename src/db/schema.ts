import type { Db } from "./shared";

export function ensureSchema(db: Db): void {
  ensureSessionsTable(db);
  ensureMessagesTable(db);
  ensureMessagesFtsTable(db);
  ensureSessionsFtsTable(db);
  ensureCoverageTable(db);

  dropLegacyTrigramTable(db);
  db.pragma("foreign_keys = ON");
}

function ensureSessionsTable(db: Db): void {
  const existingSql = tableSql(db, "sessions");
  if (existingSql && needsSessionsRebuild(db, existingSql)) {
    rebuildSessionsTable(db);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
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
    )
  `);

  ensureTextColumn(db, "sessions", "source_id", "'codex'");
  ensureTextColumn(db, "sessions", "native_session_id");
  ensureTextColumn(db, "sessions", "session_key");
  ensureTextColumn(db, "sessions", "summary_text");
  ensureTextColumn(db, "sessions", "compact_text");
  ensureTextColumn(db, "sessions", "reasoning_summary_text");
  ensureTextColumn(db, "sessions", "path_date");
  ensureTextColumn(db, "sessions", "source_root");
  backfillSessionIdentity(db);

  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_source_started_at ON sessions(source_id, started_at DESC)");
}

function ensureMessagesTable(db: Db): void {
  const existingSql = tableSql(db, "messages");
  if (existingSql && needsMessagesRebuild(existingSql)) {
    rebuildMessagesTable(db);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      session_uuid TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content_text TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      UNIQUE(session_id, seq)
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_session_uuid ON messages(session_uuid)");
}

function ensureMessagesFtsTable(db: Db): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content_text,
      session_uuid UNINDEXED,
      seq UNINDEXED,
      role UNINDEXED,
      timestamp UNINDEXED,
      tokenize='unicode61 remove_diacritics 1'
    )
  `);
}

function ensureCoverageTable(db: Db): void {
  const existingSql = tableSql(db, "coverage");
  if (existingSql && needsCoverageRebuild(db, existingSql)) {
    rebuildCoverageTable(db);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS coverage (
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
    )
  `);

  ensureTextColumn(db, "coverage", "source_id", "'codex'");
  ensureTextColumn(db, "coverage", "source_file_set_fingerprint");
  backfillCoverageSource(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_coverage_root ON coverage(root)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_coverage_source_root ON coverage(source_id, root)");
}

function dropLegacyTrigramTable(db: Db): void {
  // cxs <= v2 shipped a second FTS5 virtual table for CJK trigram search.
  // The hybrid bigram+Segmenter tokenizer in tokenize.ts replaces it, so
  // drop the old table and its shadow rows if they still exist.
  db.exec("DROP TABLE IF EXISTS messages_fts_trigram");
}

function ensureSessionsFtsTable(db: Db): void {
  const existing = db
    .prepare("SELECT 1 FROM sqlite_master WHERE name = 'sessions_fts' LIMIT 1")
    .get();

  if (existing) {
    const columns = db
      .prepare("PRAGMA table_info(sessions_fts)")
      .all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("compact_text") || !names.has("reasoning_summary_text")) {
      db.exec("DROP TABLE sessions_fts");
    }
  }

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      title,
      summary_text,
      compact_text,
      reasoning_summary_text,
      session_uuid UNINDEXED,
      tokenize='unicode61 remove_diacritics 1'
    )
  `);
}

function ensureTextColumn(db: Db, tableName: string, columnName: string, defaultSql = "''"): void {
  const identifierRegex = /^[a-zA-Z0-9_]+$/;
  if (!identifierRegex.test(tableName) || !identifierRegex.test(columnName)) {
    throw new Error(`Invalid table or column name: ${tableName}.${columnName}`);
  }

  const columns = db
    .prepare("SELECT name FROM pragma_table_info(?)")
    .all(tableName) as Array<{ name?: string }>;

  if (columns.some((column) => column.name === columnName)) return;

  const quoteId = (id: string) => `"${id.replace(/"/g, '""')}"`;
  db.exec(`ALTER TABLE ${quoteId(tableName)} ADD COLUMN ${quoteId(columnName)} TEXT NOT NULL DEFAULT ${defaultSql}`);
}

function needsSessionsRebuild(db: Db, sql: string): boolean {
  const columns = columnNames(db, "sessions");
  return !columns.has("source_id")
    || !columns.has("native_session_id")
    || !columns.has("session_key")
    || /\bsession_uuid\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b/i.test(sql)
    || /\bfile_path\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b/i.test(sql);
}

function needsMessagesRebuild(sql: string): boolean {
  return /UNIQUE\s*\(\s*session_uuid\s*,\s*seq\s*\)/i.test(sql);
}

function needsCoverageRebuild(db: Db, _sql: string): boolean {
  return !columnNames(db, "coverage").has("source_id");
}

function rebuildSessionsTable(db: Db): void {
  db.pragma("foreign_keys = OFF");
  db.exec(`
    ALTER TABLE sessions RENAME TO sessions_old_source_migration;
    CREATE TABLE sessions (
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
    INSERT INTO sessions (
      id, source_id, native_session_id, session_key, session_uuid, file_path, source_root,
      title, summary_text, compact_text, reasoning_summary_text, cwd, model,
      started_at, ended_at, path_date, message_count, raw_file_mtime, raw_file_size,
      index_version, updated_at
    )
    SELECT
      id,
      'codex',
      session_uuid,
      'codex:' || session_uuid,
      session_uuid,
      file_path,
      COALESCE(source_root, ''),
      COALESCE(title, ''),
      COALESCE(summary_text, ''),
      COALESCE(compact_text, ''),
      COALESCE(reasoning_summary_text, ''),
      COALESCE(cwd, ''),
      COALESCE(model, ''),
      started_at,
      ended_at,
      COALESCE(path_date, ''),
      COALESCE(message_count, 0),
      COALESCE(raw_file_mtime, 0),
      COALESCE(raw_file_size, 0),
      COALESCE(index_version, ''),
      COALESCE(updated_at, CURRENT_TIMESTAMP)
    FROM sessions_old_source_migration;
    DROP TABLE sessions_old_source_migration;
  `);
}

function rebuildMessagesTable(db: Db): void {
  db.exec(`
    ALTER TABLE messages RENAME TO messages_old_source_migration;
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
    INSERT OR IGNORE INTO messages (
      id, session_id, session_uuid, seq, role, content_text, timestamp, source_kind
    )
    SELECT id, session_id, session_uuid, seq, role, content_text, timestamp, source_kind
    FROM messages_old_source_migration;
    DROP TABLE messages_old_source_migration;
  `);
}

function rebuildCoverageTable(db: Db): void {
  db.exec(`
    ALTER TABLE coverage RENAME TO coverage_old_source_migration;
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
    );
    INSERT INTO coverage (
      id, source_id, selector_key, selector_json, selector_kind, root, cwd, from_date,
      to_date, source_fingerprint, source_file_set_fingerprint, source_file_count, indexed_session_count,
      completed_at, index_version
    )
    SELECT
      id,
      'codex',
      selector_key,
      selector_json,
      selector_kind,
      root,
      cwd,
      from_date,
      to_date,
      source_fingerprint,
      '',
      source_file_count,
      indexed_session_count,
      completed_at,
      index_version
    FROM coverage_old_source_migration;
    DROP TABLE coverage_old_source_migration;
  `);
}

function backfillSessionIdentity(db: Db): void {
  db.exec(`
    UPDATE sessions
    SET
      source_id = CASE WHEN source_id = '' THEN 'codex' ELSE source_id END,
      native_session_id = CASE WHEN native_session_id = '' THEN session_uuid ELSE native_session_id END,
      session_key = CASE
        WHEN session_key = '' THEN (CASE WHEN source_id = '' THEN 'codex' ELSE source_id END) || ':' || session_uuid
        ELSE session_key
      END
  `);
}

function backfillCoverageSource(db: Db): void {
  const rows = db
    .prepare("SELECT id, source_id, selector_json FROM coverage")
    .all() as Array<{ id: number; source_id: string; selector_json: string }>;
  const update = db.prepare<[string, string, string, number]>(
    "UPDATE coverage SET source_id = ?, selector_key = ?, selector_json = ? WHERE id = ?"
  );

  for (const row of rows) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.selector_json) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const source = typeof parsed.source === "string" && parsed.source ? parsed.source : row.source_id || "codex";
    parsed.source = source;
    update.run(source, JSON.stringify(parsed), JSON.stringify(parsed), row.id);
  }
}

function columnNames(db: Db, tableName: string): Set<string> {
  const columns = db
    .prepare("SELECT name FROM pragma_table_info(?)")
    .all(tableName) as Array<{ name?: string }>;
  return new Set(columns.map((column) => column.name).filter((name): name is string => Boolean(name)));
}

function tableSql(db: Db, tableName: string): string | null {
  const row = db
    .prepare<[string], { sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return row?.sql ?? null;
}
