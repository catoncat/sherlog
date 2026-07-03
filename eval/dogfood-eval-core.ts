import type { FindResult } from "../src/types";
import type { DogfoodFailureClass, DogfoodGolden, DogfoodStatus } from "./dogfood-schema";

export type DogfoodMark = "pass" | "fail" | "skip";
export type DogfoodPredicateGroup = "assertion" | "answer_facet";

export interface DogfoodPredicateResult {
  label: "source_id" | "session_uuid" | "session_ref" | "cwd" | "match_source" | "match_seq" | "context" | "answer_facet";
  group: DogfoodPredicateGroup;
  facetLabel?: string;
  expected: string;
  actual: string;
  matched: boolean;
  failureClass?: DogfoodFailureClass;
}

export interface SelectedDogfoodHit {
  hit: FindResult | null;
  rank: number | null;
  topK: number;
}

export interface DogfoodEvaluationInput {
  item: DogfoodGolden;
  results: FindResult[];
  contextText?: string;
  contextKind?: "read-range" | "read-page";
  contextUnavailableReason?: string;
}

export interface DogfoodEvaluation {
  mark: DogfoodMark;
  blocking: boolean;
  selected: SelectedDogfoodHit;
  predicateResults: DogfoodPredicateResult[];
  assertionMark: DogfoodMark;
  facetMark: DogfoodMark;
  failureClasses: DogfoodFailureClass[];
}

export interface DogfoodScoreboard {
  total: number;
  pass: number;
  fail: number;
  skip: number;
  hardFail: number;
  candidateFail: number;
  assertionPass: number;
  assertionFail: number;
  facetPass: number;
  facetFail: number;
}

export function evaluateDogfoodItem(input: DogfoodEvaluationInput): DogfoodEvaluation {
  if (input.item.status === "stale") {
    return {
      mark: "skip",
      blocking: false,
      selected: { hit: null, rank: null, topK: input.item.expected.topK ?? 5 },
      predicateResults: [],
      assertionMark: "skip",
      facetMark: "skip",
      failureClasses: ["stale_golden"],
    };
  }

  const selected = selectDogfoodHit(input.item, input.results);
  const predicates = buildPredicates(input, selected);
  const mark = predicates.length > 0 && predicates.every((predicate) => predicate.matched) ? "pass" : "fail";
  const assertionMark = groupMark(predicates, "assertion");
  const facetMark = groupMark(predicates, "answer_facet");
  const failureClasses = uniqueFailureClasses(predicates);

  return {
    mark,
    blocking: input.item.status === "hard" && mark === "fail",
    selected,
    predicateResults: predicates,
    assertionMark,
    facetMark,
    failureClasses,
  };
}

export function selectDogfoodHit(item: DogfoodGolden, results: FindResult[]): SelectedDogfoodHit {
  const topK = item.expected.topK ?? 5;
  const acceptable = item.expected.acceptableSessionUuids ?? [];

  if (acceptable.length > 0) {
    const index = results.slice(0, topK).findIndex((result) => acceptable.includes(result.sessionUuid));
    if (index >= 0) return { hit: results[index]!, rank: index + 1, topK };
  }

  return { hit: results[0] ?? null, rank: results.length > 0 ? 1 : null, topK };
}

export function desiredContextMode(item: DogfoodGolden, hit: FindResult | null): "read-range" | "read-page" | null {
  const context = item.expected.context;
  if (!context?.mustContain?.length && !item.expected.answerFacets?.length) return null;
  const mode = context?.mode ?? "auto";
  if (mode !== "auto") return mode;
  // Session-only hits now use read-range --query to locate the real anchor,
  // so auto mode always prefers read-range.
  return "read-range";
}

export function missingContextNeedles(item: DogfoodGolden, contextText: string): string[] {
  const haystack = contextText.toLowerCase();
  return expectedEvidenceNeedles(item).filter((needle) => !haystack.includes(needle.toLowerCase()));
}

export function buildDogfoodScoreboard(rows: Array<{ status: DogfoodStatus; evaluation: Pick<DogfoodEvaluation, "mark" | "assertionMark" | "facetMark"> }>): DogfoodScoreboard {
  const scoreboard: DogfoodScoreboard = {
    total: rows.length,
    pass: 0,
    fail: 0,
    skip: 0,
    hardFail: 0,
    candidateFail: 0,
    assertionPass: 0,
    assertionFail: 0,
    facetPass: 0,
    facetFail: 0,
  };
  for (const row of rows) {
    scoreboard[row.evaluation.mark] += 1;
    if (row.status === "hard" && row.evaluation.mark === "fail") scoreboard.hardFail += 1;
    if (row.status === "candidate" && row.evaluation.mark === "fail") scoreboard.candidateFail += 1;
    if (row.evaluation.assertionMark === "pass") scoreboard.assertionPass += 1;
    if (row.evaluation.assertionMark === "fail") scoreboard.assertionFail += 1;
    if (row.evaluation.facetMark === "pass") scoreboard.facetPass += 1;
    if (row.evaluation.facetMark === "fail") scoreboard.facetFail += 1;
  }
  return scoreboard;
}

function buildPredicates(
  input: DogfoodEvaluationInput,
  selected: SelectedDogfoodHit,
): DogfoodPredicateResult[] {
  const { item } = input;
  const hit = selected.hit;
  const predicates: DogfoodPredicateResult[] = [];
  const acceptable = item.expected.acceptableSessionUuids ?? [];

  if (item.expected.sourceId) {
    predicates.push({
      label: "source_id",
      group: "assertion",
      expected: item.expected.sourceId,
      actual: hit?.sourceId ?? "no selected hit",
      matched: hit?.sourceId === item.expected.sourceId,
      failureClass: hit ? "cli_recall_ranking_context" : "coverage_index",
    });
  }

  if (acceptable.length > 0) {
    predicates.push({
      label: "session_uuid",
      group: "assertion",
      expected: `one of ${acceptable.join(", ")} in top ${selected.topK}`,
      actual: hit ? `${hit.sessionUuid} at rank ${selected.rank}` : "no results",
      matched: Boolean(hit && acceptable.includes(hit.sessionUuid) && (selected.rank ?? Infinity) <= selected.topK),
      failureClass: hit ? "cli_recall_ranking_context" : "coverage_index",
    });
  }

  if (item.expected.sessionRef) {
    predicates.push({
      label: "session_ref",
      group: "assertion",
      expected: item.expected.sessionRef,
      actual: hit?.sessionRef ?? "no selected hit",
      matched: hit?.sessionRef === item.expected.sessionRef,
      failureClass: hit ? "cli_recall_ranking_context" : "coverage_index",
    });
  }

  if (item.expected.cwdContains) {
    const needle = item.expected.cwdContains.toLowerCase();
    predicates.push({
      label: "cwd",
      group: "assertion",
      expected: item.expected.cwdContains,
      actual: hit?.cwd ?? "no selected hit",
      matched: Boolean(hit?.cwd.toLowerCase().includes(needle)),
      failureClass: hit ? "cli_recall_ranking_context" : "coverage_index",
    });
  }

  if (item.expected.matchSource) {
    predicates.push({
      label: "match_source",
      group: "assertion",
      expected: item.expected.matchSource,
      actual: hit?.matchSource ?? "no selected hit",
      matched: hit?.matchSource === item.expected.matchSource,
      failureClass: hit ? "cli_recall_ranking_context" : "coverage_index",
    });
  }

  if (item.expected.matchSeq !== undefined) {
    predicates.push({
      label: "match_seq",
      group: "assertion",
      expected: String(item.expected.matchSeq),
      actual: hit ? String(hit.matchSeq) : "no selected hit",
      matched: hit?.matchSeq === item.expected.matchSeq,
      failureClass: hit ? "cli_recall_ranking_context" : "coverage_index",
    });
  }

  for (const needle of item.expected.context?.mustContain ?? []) {
    const haystack = input.contextText ?? "";
    predicates.push({
      label: "context",
      group: "assertion",
      expected: needle,
      actual: input.contextUnavailableReason ?? contextActual(input.contextKind, haystack),
      matched: haystack.toLowerCase().includes(needle.toLowerCase()),
      failureClass: contextFailureClass(input),
    });
  }

  for (const facet of item.expected.answerFacets ?? []) {
    const haystack = input.contextText ?? "";
    const missing = facet.mustContain.filter((needle) => !haystack.toLowerCase().includes(needle.toLowerCase()));
    predicates.push({
      label: "answer_facet",
      group: "answer_facet",
      facetLabel: facet.label,
      expected: `${facet.label}: ${facet.mustContain.join(" + ")}`,
      actual: input.contextUnavailableReason ?? (missing.length > 0 ? `missing: ${missing.join(", ")}` : contextActual(input.contextKind, haystack)),
      matched: missing.length === 0,
      failureClass: facet.failureClass ?? contextFailureClass(input),
    });
  }

  return predicates;
}

function expectedEvidenceNeedles(item: DogfoodGolden): string[] {
  return [
    ...(item.expected.context?.mustContain ?? []),
    ...(item.expected.answerFacets ?? []).flatMap((facet) => facet.mustContain),
  ];
}

function groupMark(predicates: DogfoodPredicateResult[], group: DogfoodPredicateGroup): DogfoodMark {
  const groupPredicates = predicates.filter((predicate) => predicate.group === group);
  if (groupPredicates.length === 0) return "skip";
  return groupPredicates.every((predicate) => predicate.matched) ? "pass" : "fail";
}

function uniqueFailureClasses(predicates: DogfoodPredicateResult[]): DogfoodFailureClass[] {
  return [...new Set(predicates.filter((predicate) => !predicate.matched).map((predicate) => predicate.failureClass ?? "unclear_case"))];
}

function contextFailureClass(input: DogfoodEvaluationInput): DogfoodFailureClass {
  if (input.contextUnavailableReason?.includes("no selected hit") || input.contextUnavailableReason?.includes("no results")) {
    return "coverage_index";
  }
  return "cli_recall_ranking_context";
}

function contextActual(kind: string | undefined, text: string): string {
  if (!text) return kind ? `${kind}: empty context` : "context not read";
  return `${kind ?? "context"}: ${text.length} chars`;
}
