import { tokenizedText } from "../tokenize";
import { DEFAULT_SESSION_SOURCE_ID, isSessionSourceId, type ParsedSession, type SessionRecord, type SessionSourceId } from "../types";
import type { Db } from "./shared";
import { sessionRootFromFile } from "./sql";

export function getIndexedSessionMeta(
  db: Db,
  filePath: string,
  sourceId: SessionSourceId = DEFAULT_SESSION_SOURCE_ID,
): { rawFileMtime: number; rawFileSize: number; indexVersion: string } | null {
  const row = db
    .prepare<[SessionSourceId, string], { rawFileMtime: number; rawFileSize: number; indexVersion: string }>(`
      SELECT raw_file_mtime AS rawFileMtime, raw_file_size AS rawFileSize, index_version AS indexVersion
      FROM sessions
      WHERE source_id = ? AND file_path = ?
      LIMIT 1
    `)
    .get(sourceId, filePath) as
    | { rawFileMtime: number; rawFileSize: number; indexVersion: string }
    | undefined;

  return row ?? null;
}

export function getIndexedSessionMetas(
  db: Db,
  filePaths: string[],
  sourceId: SessionSourceId = DEFAULT_SESSION_SOURCE_ID,
): Map<string, { rawFileMtime: number; rawFileSize: number; indexVersion: string }> {
  const map = new Map<string, { rawFileMtime: number; rawFileSize: number; indexVersion: string }>();
  if (filePaths.length === 0) return map;

  const chunkSize = 500;
  for (let i = 0; i < filePaths.length; i += chunkSize) {
    const chunk = filePaths.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db
      .prepare<[SessionSourceId, ...string[]], { file_path: string; rawFileMtime: number; rawFileSize: number; indexVersion: string }>(`
        SELECT file_path, raw_file_mtime AS rawFileMtime, raw_file_size AS rawFileSize, index_version AS indexVersion
        FROM sessions
        WHERE source_id = ? AND file_path IN (${placeholders})
      `)
      .all(sourceId, ...chunk) as { file_path: string; rawFileMtime: number; rawFileSize: number; indexVersion: string }[];

    for (const row of rows) {
      map.set(row.file_path, {
        rawFileMtime: row.rawFileMtime,
        rawFileSize: row.rawFileSize,
        indexVersion: row.indexVersion,
      });
    }
  }

  return map;
}

export function deleteSessionByFilePath(db: Db, filePath: string, sourceId: SessionSourceId = DEFAULT_SESSION_SOURCE_ID): void {
  const row = db
    .prepare<[SessionSourceId, string], { id: number }>("SELECT id FROM sessions WHERE source_id = ? AND file_path = ? LIMIT 1")
    .get(sourceId, filePath) as { id: number } | undefined;

  if (!row) return;
  deleteSessionById(db, row.id);
}

export function deleteSessionByUuid(db: Db, sessionUuid: string, sourceId: SessionSourceId = DEFAULT_SESSION_SOURCE_ID): void {
  const row = db
    .prepare<[SessionSourceId, string], { id: number }>("SELECT id FROM sessions WHERE source_id = ? AND native_session_id = ? LIMIT 1")
    .get(sourceId, sessionUuid) as { id: number } | undefined;
  if (!row) return;
  deleteSessionById(db, row.id);
}

export function deleteSessionById(db: Db, sessionId: number): void {
  db.prepare("DELETE FROM sessions_fts WHERE rowid = ?").run(sessionId);
  db.prepare("DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE session_id = ?)").run(sessionId);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function replaceSession(
  db: Db,
  session: ParsedSession,
  rawFileMtime: number,
  rawFileSize: number,
  indexVersion: string,
  pathDate: string,
  sourceRoot = sessionRootFromFile(session.filePath),
): void {
  const identity = sessionIdentity(session);
  const tx = db.transaction(() => {
    const existing = db
      .prepare<[SessionSourceId, string, SessionSourceId, string], { id: number; sessionUuid: string }>(`
        SELECT id, session_uuid AS sessionUuid
        FROM sessions
        WHERE (source_id = ? AND native_session_id = ?) OR (source_id = ? AND file_path = ?)
        LIMIT 1
      `)
      .get(identity.sourceId, identity.nativeSessionId, identity.sourceId, session.filePath) as { id: number; sessionUuid: string } | undefined;

    if (existing) {
      db.prepare(
        `
          UPDATE sessions
          SET source_id = ?, native_session_id = ?, session_key = ?, session_uuid = ?, file_path = ?, source_root = ?,
              title = ?, summary_text = ?, compact_text = ?, reasoning_summary_text = ?,
              cwd = ?, model = ?, started_at = ?, ended_at = ?, path_date = ?,
              message_count = ?, raw_file_mtime = ?, raw_file_size = ?, index_version = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
      ).run(
        identity.sourceId,
        identity.nativeSessionId,
        identity.sessionKey,
        session.sessionUuid,
        session.filePath,
        sourceRoot,
        session.title,
        session.summaryText,
        session.compactText ?? "",
        session.reasoningSummaryText ?? "",
        session.cwd,
        session.model,
        session.startedAt,
        session.endedAt,
        pathDate,
        session.messages.length,
        rawFileMtime,
        rawFileSize,
        indexVersion,
        existing.id,
      );
    } else {
      db.prepare(
        `
          INSERT INTO sessions (
            source_id, native_session_id, session_key, session_uuid, file_path, source_root,
            title, summary_text, compact_text, reasoning_summary_text,
            cwd, model, started_at, ended_at, path_date,
            message_count, raw_file_mtime, raw_file_size, index_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        identity.sourceId,
        identity.nativeSessionId,
        identity.sessionKey,
        session.sessionUuid,
        session.filePath,
        sourceRoot,
        session.title,
        session.summaryText,
        session.compactText ?? "",
        session.reasoningSummaryText ?? "",
        session.cwd,
        session.model,
        session.startedAt,
        session.endedAt,
        pathDate,
        session.messages.length,
        rawFileMtime,
        rawFileSize,
        indexVersion,
      );
    }

    const sessionRow = db
      .prepare<[string], { id: number }>("SELECT id FROM sessions WHERE session_key = ? LIMIT 1")
      .get(identity.sessionKey) as { id: number };

    db.prepare("DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE session_id = ?)").run(sessionRow.id);
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionRow.id);
    db.prepare("DELETE FROM sessions_fts WHERE rowid = ?").run(sessionRow.id);

    db.prepare(
      `
        INSERT INTO sessions_fts(rowid, title, summary_text, compact_text, reasoning_summary_text, session_uuid)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    ).run(
      sessionRow.id,
      tokenizedText(session.title),
      tokenizedText(session.summaryText),
      tokenizedText(session.compactText ?? ""),
      tokenizedText(session.reasoningSummaryText ?? ""),
      session.sessionUuid,
    );

    const messageStmt = db.prepare<[number, string, number, string, string, string, string]>(`
      INSERT INTO messages (session_id, session_uuid, seq, role, content_text, timestamp, source_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const ftsStmt = db.prepare<[number, string, string, number, string, string]>(`
      INSERT INTO messages_fts(rowid, content_text, session_uuid, seq, role, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const message of session.messages) {
      const result = messageStmt.run(
        sessionRow.id,
        session.sessionUuid,
        message.seq,
        message.role,
        message.contentText,
        message.timestamp,
        message.sourceKind,
      );
      const messageId = Number(result.lastInsertRowid);
      // Feed the FTS index with tokenized text so that CJK runs are split
      // into bigrams by tokenize(). Stored content in messages.content_text
      // stays raw for display.
      ftsStmt.run(
        messageId,
        tokenizedText(message.contentText),
        session.sessionUuid,
        message.seq,
        message.role,
        message.timestamp,
      );
    }
  });

  tx();
}

export function getSessionRecord(db: Db, sessionUuid: string): SessionRecord | null {
  const identity = parseSessionRef(sessionUuid);
  const row = db
    .prepare<[SessionSourceId, string], SessionRecord & { filePath: string }>(`
      SELECT
        id,
        source_id AS sourceId,
        native_session_id AS nativeSessionId,
        session_key AS sessionKey,
        session_uuid AS sessionUuid,
        file_path AS filePath,
        source_root AS sourceRoot,
        title,
        summary_text AS summaryText,
        cwd,
        model,
        started_at AS startedAt,
        ended_at AS endedAt,
        path_date AS pathDate,
        message_count AS messageCount
      FROM sessions
      WHERE source_id = ? AND native_session_id = ?
      LIMIT 1
    `)
    .get(identity.sourceId, identity.nativeSessionId) as (SessionRecord & { filePath: string }) | undefined;

  if (!row) return null;
  return row;
}

function sessionIdentity(session: ParsedSession): {
  sourceId: SessionSourceId;
  nativeSessionId: string;
  sessionKey: string;
} {
  const sourceId = session.sourceId ?? DEFAULT_SESSION_SOURCE_ID;
  const nativeSessionId = session.nativeSessionId ?? session.sessionUuid;
  return {
    sourceId,
    nativeSessionId,
    sessionKey: session.sessionKey ?? `${sourceId}:${nativeSessionId}`,
  };
}

function parseSessionRef(sessionRef: string): { sourceId: SessionSourceId; nativeSessionId: string } {
  const separator = sessionRef.indexOf(":");
  if (separator > 0) {
    const sourceId = sessionRef.slice(0, separator);
    const nativeSessionId = sessionRef.slice(separator + 1);
    if (isSessionSourceId(sourceId)) return { sourceId, nativeSessionId };
  }
  return { sourceId: DEFAULT_SESSION_SOURCE_ID, nativeSessionId: sessionRef };
}
