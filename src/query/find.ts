import { withReadDb, type Db } from "../db";
import type { RawHitRow } from "../ranking";
import { rerankHits } from "../ranking";
import type { FindResult, FindSort, FindSummary, Selector } from "../types";
import { buildCoverageStatus } from "./coverage";
import { buildZeroResultsNextAction } from "./next-action";
import { buildRelaxedRecallQueries } from "./relaxed-recall";
import { searchMessageHits, searchSessionHits } from "./search";

export interface FindSessionsOptions {
  sort?: FindSort;
  excludeSessions?: string[];
}

export function findSessions(
  dbPath: string,
  query: string,
  limit: number,
  selector: Selector | null = null,
  options: FindSessionsOptions = {},
): FindSummary {
  return withReadDb(dbPath, (db) => {
    const sort = options.sort ?? "relevance";
    const excludedSessions = uniqueNonEmpty(options.excludeSessions ?? []);
    const recallLimit = sort === "relevance" ? Math.max(limit * 12, 50) : Math.max(limit * 100, 1000);
    let rawRows = searchRows(db, query, recallLimit, selector, sort, excludedSessions);
    if (rawRows.length === 0) {
      const fallbackRows = new Map<string, RawHitRow>();
      for (const relaxedQuery of buildRelaxedRecallQueries(query)) {
        for (const row of searchRows(db, relaxedQuery, recallLimit, selector, sort, excludedSessions)) {
          const key = rawHitKey(row);
          if (!fallbackRows.has(key)) fallbackRows.set(key, row);
        }
      }
      rawRows = [...fallbackRows.values()];
    }
    const ranked = rerankHits(rawRows, query, Math.max(rawRows.length, limit));
    const results = sort === "relevance"
      ? ranked.slice(0, limit)
      : ranked.sort((left, right) => compareByTime(left, right, sort)).slice(0, limit)
        .map((result, index) => ({ ...result, rank: index + 1 }));
    const coverage = buildCoverageStatus(db, selector);
    return {
      query,
      sort,
      excludedSessions,
      results,
      coverage,
      nextAction: results.length === 0 ? buildZeroResultsNextAction(selector, "this find") : undefined,
    };
  });
}

function searchRows(
  db: Db,
  query: string,
  recallLimit: number,
  selector: Selector | null,
  sort: FindSort,
  excludedSessions: string[],
): RawHitRow[] {
  return [
    ...searchMessageHits(db, query, recallLimit, undefined, selector, { sort, excludeSessions: excludedSessions }),
    ...searchSessionHits(db, query, recallLimit, selector, { sort, excludeSessions: excludedSessions }),
  ];
}

function rawHitKey(row: RawHitRow): string {
  return `${row.sessionKey ?? row.sessionUuid}\0${row.matchSource}\0${row.matchSeq ?? "session"}`;
}

function compareByTime(left: FindResult, right: FindResult, sort: FindSort): number {
  // OPTIMIZATION: ISO 8601 strings compare correctly lexicographically.
  // Replacing Date.parse() with string comparison avoids significant parsing overhead
  // during sort operations while maintaining the exact same ordering semantics.
  const leftTime = sort === "started" ? left.startedAt : left.endedAt;
  const rightTime = sort === "started" ? right.startedAt : right.endedAt;

  if (rightTime > leftTime) return 1;
  if (rightTime < leftTime) return -1;

  return right.score - left.score;
}

function uniqueNonEmpty(values: string[]): string[] {
  // OPTIMIZATION: Use a single loop to populate the Set.
  // Avoids intermediate array allocations from map() and filter() operations.
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}
