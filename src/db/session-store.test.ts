import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { INDEX_VERSION } from "../env";
import { findSessions, getMessagePage } from "../query";
import { openReadDb, openWriteDb, replaceSession } from "../db";
import type { SessionSourceId } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("replaceSession", () => {
  test("replacing the same file with a new session uuid removes old messages and FTS rows", () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-session-store-uuid-change-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");
    const filePath = join(base, "sessions", "rollout.jsonl");
    const db = openWriteDb(dbPath);

    replaceSession(
      db,
      sessionFixture({
        sessionUuid: "11111111-1111-4111-8111-111111111111",
        filePath,
        message: "old unique needle",
      }),
      1,
      100,
      INDEX_VERSION,
      "2026-04-22",
      join(base, "sessions"),
    );
    replaceSession(
      db,
      sessionFixture({
        sessionUuid: "22222222-2222-4222-8222-222222222222",
        filePath,
        message: "new unique needle",
      }),
      2,
      100,
      INDEX_VERSION,
      "2026-04-22",
      join(base, "sessions"),
    );
    db.close();

    const readDb = openReadDb(dbPath);
    const messageRows = readDb.prepare("SELECT session_uuid AS sessionUuid, content_text AS contentText FROM messages").all() as Array<{
      sessionUuid: string;
      contentText: string;
    }>;
    const ftsCount = readDb.prepare("SELECT COUNT(*) AS count FROM messages_fts").get() as { count: number };
    readDb.close();

    expect(messageRows).toEqual([
      {
        sessionUuid: "22222222-2222-4222-8222-222222222222",
        contentText: "new unique needle",
      },
    ]);
    expect(ftsCount.count).toBe(1);
    expect(findSessions(dbPath, "old unique needle", 5).results).toEqual([]);
    expect(findSessions(dbPath, "new unique needle", 5).results[0]?.sessionUuid).toBe("22222222-2222-4222-8222-222222222222");
  });

  test("backfills old Codex rows with source-aware identity without deleting data", () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-session-store-backfill-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");
    const filePath = join(base, "sessions", "legacy.jsonl");
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_uuid TEXT NOT NULL UNIQUE,
        file_path TEXT NOT NULL UNIQUE,
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
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
        UNIQUE(session_uuid, seq)
      );
      INSERT INTO sessions (
        session_uuid, file_path, source_root, title, summary_text, cwd, model,
        started_at, ended_at, path_date, message_count, raw_file_mtime, raw_file_size, index_version
      ) VALUES (
        '33333333-3333-4333-8333-333333333333', '${filePath}', '${join(base, "sessions")}',
        'legacy title', 'legacy summary', '/tmp/legacy', 'gpt-5.4',
        '2026-04-22T00:00:00.000Z', '2026-04-22T00:00:00.000Z', '2026-04-22',
        0, 1, 1, 'old-version'
      );
      INSERT INTO messages (
        session_id, session_uuid, seq, role, content_text, timestamp, source_kind
      ) VALUES (
        1, '33333333-3333-4333-8333-333333333333', 0, 'user', 'legacy message survives',
        '2026-04-22T00:00:00.000Z', 'event_msg'
      );
    `);
    legacyDb.close();

    const db = openWriteDb(dbPath);
    db.close();

    const readDb = openReadDb(dbPath);
    const row = readDb.prepare(`
      SELECT
        s.source_id AS sourceId,
        s.native_session_id AS nativeSessionId,
        s.session_key AS sessionKey,
        s.session_uuid AS sessionUuid,
        m.content_text AS contentText
      FROM sessions s
      JOIN messages m ON m.session_id = s.id
      LIMIT 1
    `).get() as { sourceId: string; nativeSessionId: string; sessionKey: string; sessionUuid: string; contentText: string };
    readDb.close();

    expect(row).toEqual({
      sourceId: "codex",
      nativeSessionId: "33333333-3333-4333-8333-333333333333",
      sessionKey: "codex:33333333-3333-4333-8333-333333333333",
      sessionUuid: "33333333-3333-4333-8333-333333333333",
      contentText: "legacy message survives",
    });
  });

  test("keeps colliding native session ids isolated by source for find and read", () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-session-store-source-collision-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");
    const nativeId = "44444444-4444-4444-8444-444444444444";
    const db = openWriteDb(dbPath);

    replaceSession(
      db,
      sessionFixture({
        sessionUuid: nativeId,
        filePath: join(base, "codex", "same.jsonl"),
        message: "codex unique needle",
      }),
      1,
      100,
      INDEX_VERSION,
      "2026-04-22",
      join(base, "codex"),
    );
    replaceSession(
      db,
      sessionFixture({
        sourceId: "claude-code",
        sessionUuid: nativeId,
        filePath: join(base, "claude", "same.jsonl"),
        message: "claude unique needle",
      }),
      1,
      100,
      INDEX_VERSION,
      "2026-04-22",
      join(base, "claude"),
    );
    db.close();

    expect(findSessions(dbPath, "codex unique needle", 5).results.map((result) => result.sessionUuid)).toEqual([nativeId]);
    expect(findSessions(dbPath, "claude unique needle", 5).results).toEqual([]);
    expect(findSessions(
      dbPath,
      "claude unique needle",
      5,
      { source: "claude-code", kind: "all", root: join(base, "claude") },
    ).results.map((result) => result.sessionUuid)).toEqual([nativeId]);

    expect(getMessagePage(dbPath, nativeId, 0, 10).messages[0]?.contentText).toBe("codex unique needle");
    expect(getMessagePage(dbPath, `claude-code:${nativeId}`, 0, 10).messages[0]?.contentText).toBe("claude unique needle");
  });
});

function sessionFixture(options: { sourceId?: SessionSourceId; sessionUuid: string; filePath: string; message: string }) {
  const sourceId = options.sourceId ?? "codex";
  return {
    sourceId,
    nativeSessionId: options.sessionUuid,
    sessionKey: `${sourceId}:${options.sessionUuid}`,
    sessionUuid: options.sessionUuid,
    filePath: options.filePath,
    title: options.message,
    summaryText: options.message,
    compactText: "",
    reasoningSummaryText: "",
    cwd: "/tmp/uuid-change",
    model: "gpt-5.4",
    startedAt: "2026-04-22T00:00:00.000Z",
    endedAt: "2026-04-22T00:00:00.000Z",
    messages: [
      {
        role: "user" as const,
        contentText: options.message,
        timestamp: "2026-04-22T00:00:00.000Z",
        seq: 0,
        sourceKind: "event_msg" as const,
      },
    ],
  };
}
