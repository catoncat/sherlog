import { describe, expect, test } from "vitest";
import { desiredContextMode, evaluateDogfoodItem, missingContextNeedles, selectDogfoodHit } from "./dogfood-eval-core";
import { parseDogfoodJsonl } from "./dogfood-schema";
import type { DogfoodGolden } from "./dogfood-schema";
import type { FindResult } from "../src/types";

describe("dogfood eval core", () => {
  test("selects an acceptable session inside topK instead of blindly using top1", () => {
    const item = golden({ acceptableSessionUuids: ["session-b"], topK: 2 });
    const selected = selectDogfoodHit(item, [findResult({ sessionUuid: "session-a" }), findResult({ sessionUuid: "session-b" })]);

    expect(selected.hit?.sessionUuid).toBe("session-b");
    expect(selected.rank).toBe(2);
  });

  test("fails a hard item when expected session is outside topK", () => {
    const evaluation = evaluateDogfoodItem({
      item: golden({ status: "hard", acceptableSessionUuids: ["session-c"], topK: 2 }),
      results: [findResult({ sessionUuid: "session-a" }), findResult({ sessionUuid: "session-b" }), findResult({ sessionUuid: "session-c" })],
    });

    expect(evaluation.mark).toBe("fail");
    expect(evaluation.blocking).toBe(true);
  });

  test("candidate failures are reported but not blocking", () => {
    const evaluation = evaluateDogfoodItem({
      item: golden({ status: "candidate", acceptableSessionUuids: ["missing"] }),
      results: [findResult({ sessionUuid: "session-a" })],
    });

    expect(evaluation.mark).toBe("fail");
    expect(evaluation.blocking).toBe(false);
  });

  test("checks context key phrases against actual read output", () => {
    const evaluation = evaluateDogfoodItem({
      item: golden({ contextMustContain: ["official Cursor", "ccursor"] }),
      results: [findResult({ sessionUuid: "session-a" })],
      contextKind: "read-page",
      contextText: "Install official Cursor, log in, then install ccursor.",
    });

    expect(evaluation.mark).toBe("pass");
  });

  test("checks source id, session ref, and nullable match sequence", () => {
    const evaluation = evaluateDogfoodItem({
      item: golden({ sourceId: "codex", sessionRef: "session-a", matchSource: "session", matchSeq: null }),
      results: [findResult({ matchSource: "session", matchSeq: null })],
    });

    expect(evaluation.mark).toBe("pass");
    expect(evaluation.predicateResults.map((predicate) => predicate.label)).toEqual([
      "source_id",
      "session_ref",
      "match_source",
      "match_seq",
    ]);
  });

  test("uses read-range for both message and session-only hits in auto mode", () => {
    const item = golden({ contextMustContain: ["decision"] });

    expect(desiredContextMode(item, findResult({ matchSource: "message", matchSeq: 7 }))).toBe("read-range");
    expect(desiredContextMode(item, findResult({ matchSource: "session", matchSeq: null }))).toBe("read-range");
  });

  test("reports missing context needles case-insensitively", () => {
    const item = golden({ contextMustContain: ["multi-agents", "两个 explorer 回来了"] });

    expect(missingContextNeedles(item, "收到，我会按 `$MULTI-AGENTS` 开始持续推进")).toEqual(["两个 explorer 回来了"]);
  });

  test("parses find workflow options for dogfood runner attempts", () => {
    const parsed = parseDogfoodJsonl(JSON.stringify({
      id: "recent-project-skill-md",
      query: "$sherlog 最近本项目讨论 SKILLS.md 的 session",
      intent: "recover the prior skill discussion",
      status: "candidate",
      find: {
        queries: ["SKILL.md", "skills/mainline/SKILL.md"],
        sort: "ended",
        cwd: "/Users/envvar/work/repos/mainline",
        root: "/Users/envvar/.codex/sessions",
        excludeSessionUuids: ["current-session"],
      },
      expected: {
        topK: 5,
        sourceId: "codex",
        acceptableSessionUuids: ["target-session"],
        sessionRef: "target-session",
        matchSeq: null,
      },
    }), "goldens.local.jsonl");

    expect(parsed.errors).toEqual([]);
    expect(parsed.entries[0]?.find).toEqual({
      queries: ["SKILL.md", "skills/mainline/SKILL.md"],
      sort: "ended",
      cwd: "/Users/envvar/work/repos/mainline",
      root: "/Users/envvar/.codex/sessions",
      excludeSessionUuids: ["current-session"],
    });
  });
});

function golden(
  overrides: Partial<{
    status: "candidate" | "hard" | "stale";
    sourceId: "codex" | "claude-code" | "pi";
    acceptableSessionUuids: string[];
    sessionRef: string;
    matchSource: "message" | "session";
    matchSeq: number | null;
    topK: number;
    contextMustContain: string[];
  }> = {},
): DogfoodGolden {
  return {
    id: "cursor-ccursor-install-order",
    query: "Cursor ccursor 安装顺序",
    intent: "找回 Cursor 安装顺序",
    status: overrides.status ?? "hard",
    expected: {
      topK: overrides.topK,
      sourceId: overrides.sourceId,
      acceptableSessionUuids: overrides.acceptableSessionUuids,
      sessionRef: overrides.sessionRef,
      matchSource: overrides.matchSource,
      matchSeq: overrides.matchSeq,
      context: overrides.contextMustContain ? { mustContain: overrides.contextMustContain } : undefined,
    },
  };
}

function findResult(
  overrides: Partial<{
    sessionUuid: string;
    cwd: string;
    matchSource: "message" | "session";
    matchSeq: number | null;
  }> = {},
): FindResult {
  return {
    rank: 1,
    sourceId: "codex",
    sessionUuid: overrides.sessionUuid ?? "session-a",
    sessionRef: overrides.sessionUuid ?? "session-a",
    title: "title",
    summaryText: "",
    cwd: overrides.cwd ?? "/tmp/project",
    startedAt: "2026-04-22T00:00:00.000Z",
    endedAt: "2026-04-22T00:00:00.000Z",
    matchCount: 1,
    matchSource: overrides.matchSource ?? "message",
    matchSeq: overrides.matchSeq === undefined ? 0 : overrides.matchSeq,
    matchRole: overrides.matchSource === "session" ? "session" : "user",
    matchTimestamp: "2026-04-22T00:00:00.000Z",
    score: 100,
    snippet: "title",
  };
}
