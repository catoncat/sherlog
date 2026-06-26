import { describe, expect, test } from "vitest";
import { runAcceptanceGate } from "./acceptance-gate";

describe("acceptance gate", () => {
  test("passes synthetic evidence-level retrieval fixtures", async () => {
    const result = await runAcceptanceGate();

    expect(result.sync.added).toBe(4);
    expect(result.scoreboard).toMatchObject({
      total: 3,
      pass: 3,
      fail: 0,
      hardFail: 0,
    });
    expect(result.rows.map((row) => row.id)).toEqual([
      "message-hit-context",
      "session-only-compact-context",
      "cjk-message-hit",
    ]);
    expect(result.rows.every((row) => row.predicates.length > 0)).toBe(true);
  });
});
