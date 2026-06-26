import { describe, expect, test } from "vitest";
import { rerankHits, type RawHitRow } from "./ranking";

function makeRow(overrides: Partial<RawHitRow> = {}): RawHitRow {
  return {
    sessionUuid: "dummy-uuid",
    title: "dummy title",
    summaryText: "dummy summary",
    cwd: "/dummy/cwd",
    startedAt: "2024-01-01T00:00:00Z",
    endedAt: "2024-01-01T00:01:00Z",
    matchSource: "session",
    matchSeq: null,
    matchRole: "user",
    matchTimestamp: null,
    contentText: "dummy content",
    snippet: "dummy snippet",
    score: 0,
    ...overrides,
  };
}

describe("rerankHits", () => {
  test("groups rows by sessionUuid and aggregates metadata", () => {
    const rows = [
      makeRow({ sessionUuid: "sess1", title: "first session", contentText: "foo" }),
      makeRow({ sessionUuid: "sess1", title: "first session", contentText: "bar" }),
      makeRow({ sessionUuid: "sess2", title: "second session", contentText: "foo" }),
    ];

    const results = rerankHits(rows, "foo", 10);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.sessionUuid).sort()).toEqual(["sess1", "sess2"]);
  });

  test("respects limit parameter", () => {
    const rows = [
      makeRow({ sessionUuid: "sess1", score: -10 }),
      makeRow({ sessionUuid: "sess2", score: -5 }),
      makeRow({ sessionUuid: "sess3", score: -1 }),
    ];

    const results = rerankHits(rows, "dummy", 2);
    expect(results).toHaveLength(2);
  });

  test("orders sessions by score (higher is better)", () => {
    // Note: in ranking.ts, lower FTS score (which is negative bm25) means a better hit.
    // The code does `const normalizedBm25 = -row.score; // higher is better now`
    // So if row.score is -10, normalizedBm25 is 10.
    const rows = [
      makeRow({ sessionUuid: "sess1", score: -10 }), // normalized 10
      makeRow({ sessionUuid: "sess2", score: -30 }), // normalized 30
      makeRow({ sessionUuid: "sess3", score: -20 }), // normalized 20
    ];

    const results = rerankHits(rows, "dummy", 10);
    expect(results).toHaveLength(3);
    // sess2 (30) > sess3 (20) > sess1 (10)
    expect(results[0].sessionUuid).toBe("sess2");
    expect(results[1].sessionUuid).toBe("sess3");
    expect(results[2].sessionUuid).toBe("sess1");
  });

  test("breaks ties using endedAt recency (newer is better)", () => {
    const rows = [
      makeRow({ sessionUuid: "older", score: -10, endedAt: "2024-01-01T00:00:00Z" }),
      makeRow({ sessionUuid: "newer", score: -10, endedAt: "2024-01-02T00:00:00Z" }),
      makeRow({ sessionUuid: "oldest", score: -10, endedAt: "2023-12-01T00:00:00Z" }),
    ];

    const results = rerankHits(rows, "dummy", 10);
    expect(results).toHaveLength(3);
    expect(results[0].sessionUuid).toBe("newer");
    expect(results[1].sessionUuid).toBe("older");
    expect(results[2].sessionUuid).toBe("oldest");
  });

  test("prefers matchSource 'message' for the best display row", () => {
    const rows = [
      makeRow({ sessionUuid: "sess1", matchSource: "session", snippet: "session snippet", score: -50 }),
      // Even if the message has a worse FTS score (-10 -> 10 vs -50 -> 50),
      // shouldUseDisplayRow prefers 'message' over 'session'.
      makeRow({ sessionUuid: "sess1", matchSource: "message", snippet: "message snippet", score: -10 }),
    ];

    const results = rerankHits(rows, "dummy", 10);
    expect(results).toHaveLength(1);
    expect(results[0].matchSource).toBe("message");
    expect(results[0].snippet).toBe("message snippet");
  });

  test("boosts sessions where title matches query terms", () => {
    const rows = [
      makeRow({ sessionUuid: "sess1", title: "unrelated stuff", score: -10 }),
      makeRow({ sessionUuid: "sess2", title: "this has react in it", score: -10 }),
    ];

    const results = rerankHits(rows, "react", 10);
    expect(results).toHaveLength(2);
    // sess2 gets title TermHits bonus
    expect(results[0].sessionUuid).toBe("sess2");
  });

  test("boosts rows with matchRole 'user'", () => {
    const rows = [
      makeRow({ sessionUuid: "sess1", matchRole: "assistant", score: -10 }),
      makeRow({ sessionUuid: "sess2", matchRole: "user", score: -10 }), // +2 bonus for row, +4 max for session
    ];

    const results = rerankHits(rows, "dummy", 10);
    expect(results).toHaveLength(2);
    expect(results[0].sessionUuid).toBe("sess2");
  });

  test("boosts sessions where cwd matches query terms", () => {
    const rows = [
      makeRow({ sessionUuid: "sess1", cwd: "/tmp/foo", score: -10 }),
      makeRow({ sessionUuid: "sess2", cwd: "/home/user/project", score: -10 }),
    ];

    const results = rerankHits(rows, "project", 10);
    expect(results).toHaveLength(2);
    expect(results[0].sessionUuid).toBe("sess2");
  });

  test("exact query profile prefers adjacent message phrase over split metadata terms", () => {
    const rows = [
      makeRow({
        sessionUuid: "phrase",
        title: "incident archive",
        cwd: "/tmp/ops",
        matchSource: "message",
        matchSeq: 3,
        matchRole: "assistant",
        contentText: "The release checksum mismatch is isolated to the package manifest.",
        snippet: "release checksum mismatch",
        score: -6,
      }),
      makeRow({
        sessionUuid: "split-metadata",
        title: "release planning",
        cwd: "/tmp/checksum",
        matchSource: "session",
        matchSeq: null,
        matchRole: "session",
        contentText: "release planning\nchecksum checklist",
        snippet: "release planning checksum checklist",
        score: -8,
      }),
    ];

    const results = rerankHits(rows, "release checksum", 10);

    expect(results).toHaveLength(2);
    expect(results[0].sessionUuid).toBe("phrase");
  });
});
