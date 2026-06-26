import { describe, expect, test } from "vitest";
import { buildEvidenceReadAction } from "./evidence-read";

describe("buildEvidenceReadAction", () => {
  test("message hits resolve to a bounded read-range command", () => {
    expect(buildEvidenceReadAction({
      sourceId: "codex",
      sessionRef: "11111111-1111-4111-8111-111111111111",
      matchSeq: 7,
    })).toEqual({
      kind: "read-range",
      reason: "message_match",
      sourceId: "codex",
      sessionRef: "11111111-1111-4111-8111-111111111111",
      seq: 7,
      before: 2,
      after: 2,
      argv: [
        "shlog",
        "read-range",
        "11111111-1111-4111-8111-111111111111",
        "--seq",
        "7",
        "--before",
        "2",
        "--after",
        "2",
      ],
    });
  });

  test("session-only hits resolve to a bounded read-page command", () => {
    expect(buildEvidenceReadAction({
      sourceId: "claude-code",
      sessionRef: "claude-code:session-abc",
      matchSeq: null,
    })).toEqual({
      kind: "read-page",
      reason: "session_level_match",
      sourceId: "claude-code",
      sessionRef: "claude-code:session-abc",
      offset: 0,
      limit: 40,
      argv: ["shlog", "read-page", "claude-code:session-abc", "--offset", "0", "--limit", "40"],
    });
  });
});
