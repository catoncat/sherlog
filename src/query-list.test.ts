import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWriteDb, replaceSession } from "./db";
import { listSessionSummaries } from "./query";
import { tempDirs } from "./query-test-helpers";

describe("listSessionSummaries", () => {
  test("returns sessions matching query along with coverage", () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-list-session-summaries-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");
    const db = openWriteDb(dbPath);

    replaceSession(
      db,
      {
        sessionUuid: "11111111-1111-4111-8111-111111111111",
        filePath: join(base, "sessions/1.jsonl"),
        title: "Test Session 1",
        summaryText: "Summary 1",
        compactText: "",
        reasoningSummaryText: "",
        cwd: "/tmp/project-a",
        model: "gpt-5.4",
        startedAt: "2026-04-21T10:00:00.000Z",
        endedAt: "2026-04-21T10:30:00.000Z",
        messages: [],
      },
      Date.now(),
      100,
      "v1",
      "2026/04/21"
    );

    replaceSession(
      db,
      {
        sessionUuid: "22222222-2222-4222-8222-222222222222",
        filePath: join(base, "sessions/2.jsonl"),
        title: "Test Session 2",
        summaryText: "Summary 2",
        compactText: "",
        reasoningSummaryText: "",
        cwd: "/tmp/project-b",
        model: "gpt-5.4",
        startedAt: "2026-04-21T11:00:00.000Z",
        endedAt: "2026-04-21T11:30:00.000Z",
        messages: [],
      },
      Date.now(),
      200,
      "v1",
      "2026/04/21"
    );

    db.close();

    const result = listSessionSummaries(dbPath, {
      sort: "started",
      limit: 10,
    });

    expect(result.query).toEqual({ sort: "started", limit: 10 });
    expect(result.results.length).toBe(2);
    expect(result.results[0].sessionUuid).toBe("22222222-2222-4222-8222-222222222222"); // started later, should be first as sort desc
    expect(result.results[1].sessionUuid).toBe("11111111-1111-4111-8111-111111111111");

    expect(result.coverage).toEqual({
      requested: null,
      complete: false,
      freshness: "not_checked",
      coveringSelectors: [],
    });
  });

  test("filters by cwd", () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-list-session-summaries-cwd-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");
    const db = openWriteDb(dbPath);

    replaceSession(
      db,
      {
        sessionUuid: "11111111-1111-4111-8111-111111111111",
        filePath: join(base, "sessions/1.jsonl"),
        title: "Test Session 1",
        summaryText: "Summary 1",
        compactText: "",
        reasoningSummaryText: "",
        cwd: "/tmp/project-a",
        model: "gpt-5.4",
        startedAt: "2026-04-21T10:00:00.000Z",
        endedAt: "2026-04-21T10:30:00.000Z",
        messages: [],
      },
      Date.now(),
      100,
      "v1",
      "2026/04/21"
    );
    db.close();

    const result = listSessionSummaries(dbPath, {
      cwd: "project-a",
      sort: "started",
      limit: 10,
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].cwd).toBe("/tmp/project-a");
  });
});
