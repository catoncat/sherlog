import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEX_VERSION } from "../env";
import { cleanupMismatchedMessagesForSelector, coverageStatusForSelector, deleteSessionsForSelectorExceptFilePaths, listCoverageRecords, replaceCoverage } from "./coverage-store";
import { openReadDb, openWriteDb, replaceSession } from "../db";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("deleteSessionsForSelectorExceptFilePaths", () => {
  test("does not bind retained file paths into a huge NOT IN clause", () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-coverage-retained-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");
    const root = join(base, "sessions");
    const stalePath = join(root, "stale.jsonl");
    const db = openWriteDb(dbPath);

    replaceSession(
      db,
      {
        sessionUuid: "11111111-1111-4111-8111-111111111111",
        filePath: stalePath,
        title: "stale",
        summaryText: "stale",
        compactText: "",
        reasoningSummaryText: "",
        cwd: "/tmp/retained",
        model: "gpt-5.4",
        startedAt: "2026-04-22T00:00:00.000Z",
        endedAt: "2026-04-22T00:00:00.000Z",
        messages: [],
      },
      1,
      1,
      INDEX_VERSION,
      "2026-04-22",
      root,
    );

    const retained = new Set<string>();
    for (let index = 0; index < 50_000; index += 1) {
      retained.add(join(root, `retained-${index}.jsonl`));
    }

    const result = deleteSessionsForSelectorExceptFilePaths(db, { kind: "all", root }, retained);
    db.close();

    const readDb = openReadDb(dbPath);
    const count = readDb.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number };
    readDb.close();

    expect(result.removed).toBe(1);
    expect(result.retainedCold).toBe(0);
    expect(count.count).toBe(0);
  });

  test("retains sessions present under cold native ids even when file paths are gone", () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-coverage-cold-retain-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");
    const root = join(base, "sessions");
    const coldPath = join(root, "cold.jsonl");
    const missingPath = join(root, "missing.jsonl");
    const db = openWriteDb(dbPath);
    const coldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const missingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    replaceSession(
      db,
      {
        sessionUuid: coldId,
        filePath: coldPath,
        title: "cold",
        summaryText: "cold",
        compactText: "",
        reasoningSummaryText: "",
        cwd: "/tmp/cold",
        model: "gpt-5.4",
        startedAt: "2026-04-22T00:00:00.000Z",
        endedAt: "2026-04-22T00:00:00.000Z",
        messages: [],
      },
      1,
      1,
      INDEX_VERSION,
      "2026-04-22",
      root,
    );
    replaceSession(
      db,
      {
        sessionUuid: missingId,
        filePath: missingPath,
        title: "missing",
        summaryText: "missing",
        compactText: "",
        reasoningSummaryText: "",
        cwd: "/tmp/missing",
        model: "gpt-5.4",
        startedAt: "2026-04-22T00:00:00.000Z",
        endedAt: "2026-04-22T00:00:00.000Z",
        messages: [],
      },
      1,
      1,
      INDEX_VERSION,
      "2026-04-22",
      root,
    );

    const result = deleteSessionsForSelectorExceptFilePaths(
      db,
      { kind: "all", root },
      new Set(),
      new Set([coldId]),
    );
    db.close();

    const readDb = openReadDb(dbPath);
    const rows = readDb
      .prepare("SELECT native_session_id AS id FROM sessions ORDER BY native_session_id")
      .all() as Array<{ id: string }>;
    readDb.close();

    expect(result.removed).toBe(1);
    expect(result.retainedCold).toBe(1);
    expect(rows.map((row) => row.id)).toEqual([coldId]);
  });
});

describe("source-aware coverage", () => {
  test("keeps coverage implication and listing scoped by source", () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-coverage-source-aware-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");
    const root = join(base, "sessions");
    const db = openWriteDb(dbPath);

    replaceCoverage(db, { source: "codex", kind: "all", root }, "codex-fingerprint", "codex-file-set", 1, 1, INDEX_VERSION);
    replaceCoverage(db, { source: "claude-code", kind: "all", root }, "claude-fingerprint", "claude-file-set", 1, 1, INDEX_VERSION);

    const codexStatus = coverageStatusForSelector(db, { source: "codex", kind: "cwd", root, cwd: "/tmp/project" });
    const claudeStatus = coverageStatusForSelector(db, { source: "claude-code", kind: "cwd", root, cwd: "/tmp/project" });
    const defaultCoverage = listCoverageRecords(db);
    db.close();

    expect(codexStatus.complete).toBe(true);
    expect(codexStatus.coveringSelectors.map((entry) => entry.selector.source)).toEqual(["codex"]);
    expect(claudeStatus.complete).toBe(true);
    expect(claudeStatus.coveringSelectors.map((entry) => entry.selector.source)).toEqual(["claude-code"]);
    expect(defaultCoverage.map((entry) => entry.selector.source)).toEqual(["codex"]);
  });
});

describe("cleanupMismatchedMessagesForSelector", () => {
  test("removes legacy message rows whose session_uuid no longer matches the owning session row", () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-coverage-mismatched-messages-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");
    const root = join(base, "sessions");
    const filePath = join(root, "current.jsonl");
    const db = openWriteDb(dbPath);

    replaceSession(
      db,
      {
        sessionUuid: "22222222-2222-4222-8222-222222222222",
        filePath,
        title: "current",
        summaryText: "current",
        compactText: "",
        reasoningSummaryText: "",
        cwd: "/tmp/mismatch",
        model: "gpt-5.4",
        startedAt: "2026-04-22T00:00:00.000Z",
        endedAt: "2026-04-22T00:00:00.000Z",
        messages: [
          {
            role: "user",
            contentText: "current message",
            timestamp: "2026-04-22T00:00:00.000Z",
            seq: 0,
            sourceKind: "event_msg",
          },
        ],
      },
      1,
      1,
      INDEX_VERSION,
      "2026-04-22",
      root,
    );
    const session = db.prepare("SELECT id FROM sessions WHERE session_uuid = ?").get("22222222-2222-4222-8222-222222222222") as { id: number };
    const inserted = db.prepare(`
      INSERT INTO messages (session_id, session_uuid, seq, role, content_text, timestamp, source_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      "11111111-1111-4111-8111-111111111111",
      1,
      "user",
      "legacy orphan message",
      "2026-04-22T00:00:01.000Z",
      "event_msg",
    );
    db.prepare("INSERT INTO messages_fts(rowid, content_text, session_uuid, seq, role, timestamp) VALUES (?, ?, ?, ?, ?, ?)").run(
      Number(inserted.lastInsertRowid),
      "legacy orphan message",
      "11111111-1111-4111-8111-111111111111",
      1,
      "user",
      "2026-04-22T00:00:01.000Z",
    );

    const removed = cleanupMismatchedMessagesForSelector(db, { kind: "all", root });
    db.close();

    const readDb = openReadDb(dbPath);
    const messages = readDb.prepare("SELECT session_uuid AS sessionUuid, content_text AS contentText FROM messages ORDER BY seq").all() as Array<{
      sessionUuid: string;
      contentText: string;
    }>;
    const ftsRows = readDb.prepare("SELECT session_uuid AS sessionUuid FROM messages_fts").all() as Array<{ sessionUuid: string }>;
    readDb.close();

    expect(removed).toBe(1);
    expect(messages).toEqual([{ sessionUuid: "22222222-2222-4222-8222-222222222222", contentText: "current message" }]);
    expect(ftsRows).toEqual([{ sessionUuid: "22222222-2222-4222-8222-222222222222" }]);
  });
});
