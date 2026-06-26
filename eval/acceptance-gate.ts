import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desiredContextMode, evaluateDogfoodItem, type DogfoodEvaluation } from "./dogfood-eval-core";
import type { DogfoodGolden } from "./dogfood-schema";
import { syncSessions } from "../src/indexer";
import { findSessions, getMessagePage, getMessageRange } from "../src/query";
import type { FindResult, SyncSummary } from "../src/types";

const MESSAGE_HIT_SESSION = "11111111-1111-4111-8111-111111111111";
const SESSION_HIT_SESSION = "22222222-2222-4222-8222-222222222222";
const CJK_HIT_SESSION = "33333333-3333-4333-8333-333333333333";
const NOISE_SESSION = "44444444-4444-4444-8444-444444444444";
const EXACT_PHRASE_SESSION = "55555555-5555-4555-8555-555555555555";
const SPLIT_METADATA_SESSION = "66666666-6666-4666-8666-666666666666";
const CLAUDE_CODE_HIT_SESSION = "claude-code:claude-eval-session";
const PI_HIT_SESSION = "pi:pi-eval-session";

type AcceptanceSourceId = "codex" | "claude-code" | "pi";

export type AcceptanceFixtureRoots = Record<AcceptanceSourceId, string>;

export interface AcceptanceGateOptions {
  keepTemp?: boolean;
}

export interface AcceptanceGateRow {
  id: string;
  query: string;
  status: DogfoodGolden["status"];
  mark: DogfoodEvaluation["mark"];
  blocking: boolean;
  selectedRank: number | null;
  selectedSessionRef: string | null;
  selectedMatchSource: FindResult["matchSource"] | null;
  selectedMatchSeq: number | null;
  contextKind?: "read-range" | "read-page";
  predicates: DogfoodEvaluation["predicateResults"];
}

export interface AcceptanceGateResult {
  fixtureRoot: string;
  sourceRoots: AcceptanceFixtureRoots;
  dbPath: string;
  sync: SyncSummary;
  sourceSyncs: Record<AcceptanceSourceId, SyncSummary>;
  scoreboard: Record<"total" | "pass" | "fail" | "skip" | "hardFail" | "candidateFail", number>;
  rows: AcceptanceGateRow[];
}

export async function runAcceptanceGate(options: AcceptanceGateOptions = {}): Promise<AcceptanceGateResult> {
  const base = mkdtempSync(join(tmpdir(), "sherlog-acceptance-"));
  try {
    const dbPath = join(base, "index.sqlite");
    const sourceRoots = writeAcceptanceFixtures(base);
    const sourceSyncs = {
      codex: await syncSessions({ dbPath, rootDir: sourceRoots.codex }),
      "claude-code": await syncSessions({
        dbPath,
        sourceId: "claude-code",
        selector: { source: "claude-code", kind: "all", root: sourceRoots["claude-code"] },
      }),
      pi: await syncSessions({
        dbPath,
        sourceId: "pi",
        selector: { source: "pi", kind: "all", root: sourceRoots.pi },
      }),
    };
    const rows = evaluateAcceptanceItems(dbPath, acceptanceGoldens(sourceRoots));
    return {
      fixtureRoot: sourceRoots.codex,
      sourceRoots,
      dbPath,
      sync: sourceSyncs.codex,
      sourceSyncs,
      scoreboard: buildScoreboard(rows),
      rows,
    };
  } finally {
    if (!options.keepTemp) rmSync(base, { recursive: true, force: true });
  }
}

function evaluateAcceptanceItems(dbPath: string, items: DogfoodGolden[]): AcceptanceGateRow[] {
  return items.map((item) => {
    const limit = Math.max(item.expected.topK ?? 5, item.find?.limit ?? 0, 5);
    const summary = findSessions(dbPath, item.query, limit, item.find?.selector ?? null, {
      sort: item.find?.sort,
      excludeSessions: item.find?.excludeSessionUuids,
      sourceId: item.expected.sourceId,
    });
    const preselected = evaluateDogfoodItem({ item, results: summary.results }).selected;
    const context = readContextIfNeeded(dbPath, item, preselected.hit);
    const evaluation = evaluateDogfoodItem({
      item,
      results: summary.results,
      contextText: context.text,
      contextKind: context.kind,
      contextUnavailableReason: context.unavailableReason,
    });

    return {
      id: item.id,
      query: item.query,
      status: item.status,
      mark: evaluation.mark,
      blocking: evaluation.blocking,
      selectedRank: evaluation.selected.rank,
      selectedSessionRef: evaluation.selected.hit?.sessionRef ?? null,
      selectedMatchSource: evaluation.selected.hit?.matchSource ?? null,
      selectedMatchSeq: evaluation.selected.hit?.matchSeq ?? null,
      ...(context.kind ? { contextKind: context.kind } : {}),
      predicates: evaluation.predicateResults,
    };
  });
}

function readContextIfNeeded(
  dbPath: string,
  item: DogfoodGolden,
  hit: FindResult | null,
): { kind?: "read-range" | "read-page"; text?: string; unavailableReason?: string } {
  const mode = desiredContextMode(item, hit);
  if (!mode) return {};
  if (!hit) return { unavailableReason: "no selected hit for context read" };
  const context = item.expected.context ?? {};
  if (mode === "read-range") {
    if (typeof hit.matchSeq !== "number") {
      return { kind: "read-range", unavailableReason: "selected hit has no numeric matchSeq" };
    }
    const range = getMessageRange(dbPath, hit.sessionRef, {
      seq: hit.matchSeq,
      before: context.before ?? 2,
      after: context.after ?? 2,
    });
    return { kind: "read-range", text: messagesText(range.messages) };
  }

  const page = getMessagePage(dbPath, hit.sessionRef, context.offset ?? 0, context.limit ?? 20);
  return { kind: "read-page", text: messagesText(page.messages) };
}

function buildScoreboard(rows: AcceptanceGateRow[]): AcceptanceGateResult["scoreboard"] {
  const scoreboard = { total: rows.length, pass: 0, fail: 0, skip: 0, hardFail: 0, candidateFail: 0 };
  for (const row of rows) {
    scoreboard[row.mark] += 1;
    if (row.status === "hard" && row.mark === "fail") scoreboard.hardFail += 1;
    if (row.status === "candidate" && row.mark === "fail") scoreboard.candidateFail += 1;
  }
  return scoreboard;
}

function acceptanceGoldens(roots: AcceptanceFixtureRoots): DogfoodGolden[] {
  return [
    {
      id: "message-hit-context",
      query: "health check returned 500",
      intent: "message hits should identify the exact session and readable range context",
      status: "hard",
      expected: {
        topK: 1,
        sourceId: "codex",
        acceptableSessionUuids: [MESSAGE_HIT_SESSION],
        sessionRef: MESSAGE_HIT_SESSION,
        cwdContains: "/tmp/sherlog-acceptance/deploy",
        matchSource: "message",
        matchSeq: 1,
        context: {
          mode: "read-range",
          before: 1,
          after: 1,
          mustContain: ["health check returned 500", "rollback plan includes readback verification"],
        },
      },
    },
    {
      id: "session-only-compact-context",
      query: "durable output queue",
      intent: "session-level compact recall should still lead to raw transcript context",
      status: "hard",
      expected: {
        topK: 1,
        sourceId: "codex",
        acceptableSessionUuids: [SESSION_HIT_SESSION],
        sessionRef: SESSION_HIT_SESSION,
        cwdContains: "/tmp/sherlog-acceptance/handoff",
        matchSource: "session",
        matchSeq: null,
        context: {
          mode: "read-page",
          offset: 0,
          limit: 10,
          mustContain: ["Prepare release notes", "Use the existing checklist"],
        },
      },
    },
    {
      id: "cjk-message-hit",
      query: "回滚预案",
      intent: "CJK message recall should preserve evidence identity and range context",
      status: "hard",
      expected: {
        topK: 1,
        sourceId: "codex",
        acceptableSessionUuids: [CJK_HIT_SESSION],
        sessionRef: CJK_HIT_SESSION,
        cwdContains: "/tmp/sherlog-acceptance/cjk",
        matchSource: "message",
        matchSeq: 0,
        context: {
          mode: "read-range",
          before: 0,
          after: 1,
          mustContain: ["回滚预案", "健康检查恢复"],
        },
      },
    },
    {
      id: "exact-query-profile-phrase",
      query: "release checksum",
      intent: "exact multi-term queries should prefer adjacent message evidence over split metadata terms",
      status: "hard",
      expected: {
        topK: 1,
        sourceId: "codex",
        acceptableSessionUuids: [EXACT_PHRASE_SESSION],
        sessionRef: EXACT_PHRASE_SESSION,
        cwdContains: "/tmp/sherlog-acceptance/exact-phrase",
        matchSource: "message",
        matchSeq: 1,
        context: {
          mode: "read-range",
          before: 1,
          after: 0,
          mustContain: ["Investigate package audit", "release checksum mismatch"],
        },
      },
    },
    {
      id: "claude-code-message-range-context",
      query: "claude adapter needle",
      intent: "Claude Code source recall should preserve source-qualified session refs and readable range context",
      status: "hard",
      find: { selector: { source: "claude-code", kind: "all", root: roots["claude-code"] } },
      expected: {
        topK: 1,
        sourceId: "claude-code",
        acceptableSessionUuids: [CLAUDE_CODE_HIT_SESSION],
        sessionRef: CLAUDE_CODE_HIT_SESSION,
        cwdContains: "/tmp/sherlog-acceptance/claude",
        matchSource: "message",
        matchSeq: 0,
        context: {
          mode: "read-range",
          before: 0,
          after: 1,
          mustContain: ["claude adapter needle", "claude range evidence"],
        },
      },
    },
    {
      id: "pi-session-page-context",
      query: "pi compact queue",
      intent: "Pi compaction recall should preserve source-qualified session refs and readable page context",
      status: "hard",
      find: { selector: { source: "pi", kind: "all", root: roots.pi } },
      expected: {
        topK: 1,
        sourceId: "pi",
        acceptableSessionUuids: [PI_HIT_SESSION],
        sessionRef: PI_HIT_SESSION,
        cwdContains: "/tmp/sherlog-acceptance/pi",
        matchSource: "session",
        matchSeq: null,
        context: {
          mode: "read-page",
          offset: 0,
          limit: 10,
          mustContain: ["pi accepted user prompt", "pi accepted assistant reply"],
        },
      },
    },
  ];
}

function writeAcceptanceFixtures(base: string): AcceptanceFixtureRoots {
  const roots: AcceptanceFixtureRoots = {
    codex: join(base, "sessions"),
    "claude-code": join(base, "claude-projects", "synthetic-project"),
    pi: join(base, "pi-sessions"),
  };

  writeCodexAcceptanceFixtures(roots.codex);
  writeClaudeCodeAcceptanceFixture(roots["claude-code"]);
  writePiAcceptanceFixture(roots.pi);
  return roots;
}

function writeCodexAcceptanceFixtures(root: string): void {
  const day = join(root, "2026", "06", "26");
  mkdirSync(day, { recursive: true });
  writeCodexSession(day, MESSAGE_HIT_SESSION, "/tmp/sherlog-acceptance/deploy", [
    event("user_message", "Investigate deploy failure"),
    event("agent_message", "The health check returned 500 after deploy."),
    event("user_message", "The rollback plan includes readback verification."),
  ]);
  writeCodexSession(day, SESSION_HIT_SESSION, "/tmp/sherlog-acceptance/handoff", [
    event("user_message", "Prepare release notes"),
    compacted("handoff says durable output queue needs final verification"),
    event("agent_message", "Use the existing checklist before publishing."),
  ]);
  writeCodexSession(day, CJK_HIT_SESSION, "/tmp/sherlog-acceptance/cjk", [
    event("user_message", "准备回滚预案"),
    event("agent_message", "先确认健康检查恢复，再继续发布。"),
  ]);
  writeCodexSession(day, NOISE_SESSION, "/tmp/sherlog-acceptance/noise", [
    event("user_message", "Refactor parser docs"),
    event("agent_message", "No deploy or handoff evidence here."),
  ]);
  writeCodexSession(day, EXACT_PHRASE_SESSION, "/tmp/sherlog-acceptance/exact-phrase", [
    event("user_message", "Investigate package audit"),
    event("agent_message", "The release checksum mismatch is isolated to the package manifest."),
  ]);
  writeCodexSession(day, SPLIT_METADATA_SESSION, "/tmp/sherlog-acceptance/checksum", [
    event("user_message", "release planning"),
    event("agent_message", "checksum checklist covers the release planning board"),
  ]);
}

function writeClaudeCodeAcceptanceFixture(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "claude-eval.jsonl"),
    `${[
      claudeLine({
        type: "user",
        sessionId: "claude-eval-session",
        cwd: "/tmp/sherlog-acceptance/claude",
        timestamp: "2026-06-26T05:01:00.000Z",
        message: { content: "claude adapter needle should rank this session first" },
      }),
      claudeLine({
        type: "assistant",
        sessionId: "claude-eval-session",
        cwd: "/tmp/sherlog-acceptance/claude",
        timestamp: "2026-06-26T05:01:01.000Z",
        message: { content: [{ type: "text", text: "claude range evidence remains readable after source-qualified find" }] },
      }),
    ].join("\n")}\n`,
  );
}

function writePiAcceptanceFixture(root: string): void {
  const projectDir = join(root, "--tmp-pi-project--");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, "pi-eval.jsonl"),
    `${[
      piLine({ type: "session", id: "pi-eval-session", cwd: "/tmp/sherlog-acceptance/pi", timestamp: "2026-06-26T05:02:00.000Z" }),
      piLine({
        type: "message",
        timestamp: "2026-06-26T05:02:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "pi accepted user prompt" }], timestamp: "2026-06-26T05:02:01.000Z" },
      }),
      piLine({
        type: "message",
        timestamp: "2026-06-26T05:02:02.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "pi accepted assistant reply" }], timestamp: "2026-06-26T05:02:02.000Z" },
      }),
      piLine({ type: "compaction", id: "c1", timestamp: "2026-06-26T05:02:03.000Z", summary: "pi compact queue handoff survives as session recall" }),
    ].join("\n")}\n`,
  );
}

function writeCodexSession(day: string, uuid: string, cwd: string, records: Record<string, unknown>[]): void {
  const filePath = join(day, `rollout-2026-06-26T05-00-00-${uuid}.jsonl`);
  const content = [line("session_meta", { id: uuid, cwd }), line("turn_context", { model: "gpt-5.4" }), ...records]
    .map((record) => JSON.stringify(record))
    .join("\n");
  writeFileSync(filePath, content);
}

function event(type: "user_message" | "agent_message", message: string): Record<string, unknown> {
  return line("event_msg", { type, message });
}

function compacted(message: string): Record<string, unknown> {
  return line("compacted", { message });
}

function line(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    timestamp: "2026-06-26T05:00:00.000Z",
    type,
    payload,
  };
}

function claudeLine(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

function piLine(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

function messagesText(messages: Array<{ role: string; contentText: string }>): string {
  return messages.map((message) => `${message.role}: ${message.contentText}`).join("\n");
}
