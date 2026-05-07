import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEX_VERSION } from "../env";
import { findSessions } from "../query";
import { openReadDb, openWriteDb, replaceSession } from "../db";

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
});

function sessionFixture(options: { sessionUuid: string; filePath: string; message: string }) {
  return {
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
