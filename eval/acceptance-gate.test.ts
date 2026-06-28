import { describe, expect, test } from "vitest";
import { runAcceptanceGate } from "./acceptance-gate";

describe("acceptance gate", () => {
  test("passes synthetic evidence-level retrieval fixtures", async () => {
    const result = await runAcceptanceGate();

    expect(result.sync.added).toBe(4);
    expect(result.sourceSyncs["claude-code"].added).toBe(1);
    expect(result.sourceSyncs.pi.added).toBe(1);
    expect(result.scoreboard).toMatchObject({
      total: 5,
      pass: 5,
      fail: 0,
      hardFail: 0,
    });
    expect(result.rows.map((row) => row.id)).toEqual([
      "message-hit-context",
      "session-only-compact-context",
      "cjk-message-hit",
      "claude-code-message-range-context",
      "pi-session-page-context",
    ]);
    expect(result.rows.every((row) => row.predicates.length > 0)).toBe(true);
  });
});
