import type { FindResult } from "../src/types";
import type { DogfoodGolden } from "./dogfood-schema";

export type DogfoodMark = "pass" | "fail" | "skip";

export interface DogfoodPredicateResult {
  label: "source_id" | "session_uuid" | "session_ref" | "cwd" | "match_source" | "match_seq" | "context";
  expected: string;
  actual: string;
  matched: boolean;
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
}

export function evaluateDogfoodItem(input: DogfoodEvaluationInput): DogfoodEvaluation {
  if (input.item.status === "stale") {
    return {
      mark: "skip",
      blocking: false,
      selected: { hit: null, rank: null, topK: input.item.expected.topK ?? 5 },
      predicateResults: [],
    };
  }

  const selected = selectDogfoodHit(input.item, input.results);
  const predicates = buildPredicates(input, selected);
  const mark = predicates.length > 0 && predicates.every((predicate) => predicate.matched) ? "pass" : "fail";

  return {
    mark,
    blocking: input.item.status === "hard" && mark === "fail",
    selected,
    predicateResults: predicates,
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
  if (!context?.mustContain?.length) return null;
  const mode = context.mode ?? "auto";
  if (mode !== "auto") return mode;
  return typeof hit?.matchSeq === "number" ? "read-range" : "read-page";
}

export function missingContextNeedles(item: DogfoodGolden, contextText: string): string[] {
  const haystack = contextText.toLowerCase();
  return (item.expected.context?.mustContain ?? []).filter((needle) => !haystack.includes(needle.toLowerCase()));
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
      expected: item.expected.sourceId,
      actual: hit?.sourceId ?? "no selected hit",
      matched: hit?.sourceId === item.expected.sourceId,
    });
  }

  if (acceptable.length > 0) {
    predicates.push({
      label: "session_uuid",
      expected: `one of ${acceptable.join(", ")} in top ${selected.topK}`,
      actual: hit ? `${hit.sessionUuid} at rank ${selected.rank}` : "no results",
      matched: Boolean(hit && acceptable.includes(hit.sessionUuid) && (selected.rank ?? Infinity) <= selected.topK),
    });
  }

  if (item.expected.sessionRef) {
    predicates.push({
      label: "session_ref",
      expected: item.expected.sessionRef,
      actual: hit?.sessionRef ?? "no selected hit",
      matched: hit?.sessionRef === item.expected.sessionRef,
    });
  }

  if (item.expected.cwdContains) {
    const needle = item.expected.cwdContains.toLowerCase();
    predicates.push({
      label: "cwd",
      expected: item.expected.cwdContains,
      actual: hit?.cwd ?? "no selected hit",
      matched: Boolean(hit?.cwd.toLowerCase().includes(needle)),
    });
  }

  if (item.expected.matchSource) {
    predicates.push({
      label: "match_source",
      expected: item.expected.matchSource,
      actual: hit?.matchSource ?? "no selected hit",
      matched: hit?.matchSource === item.expected.matchSource,
    });
  }

  if (item.expected.matchSeq !== undefined) {
    predicates.push({
      label: "match_seq",
      expected: String(item.expected.matchSeq),
      actual: hit ? String(hit.matchSeq) : "no selected hit",
      matched: hit?.matchSeq === item.expected.matchSeq,
    });
  }

  for (const needle of item.expected.context?.mustContain ?? []) {
    const haystack = input.contextText ?? "";
    predicates.push({
      label: "context",
      expected: needle,
      actual: input.contextUnavailableReason ?? contextActual(input.contextKind, haystack),
      matched: haystack.toLowerCase().includes(needle.toLowerCase()),
    });
  }

  return predicates;
}

function contextActual(kind: string | undefined, text: string): string {
  if (!text) return kind ? `${kind}: empty context` : "context not read";
  return `${kind ?? "context"}: ${text.length} chars`;
}
