import { listSessions, withSourceAwareReadDb } from "../db";
import type { SessionListQuery, SessionListSummary } from "../types";
import { buildCoverageStatus } from "./coverage";
import { buildZeroResultsNextAction } from "./next-action";

export function listSessionSummaries(
  dbPath: string,
  query: SessionListQuery,
): SessionListSummary {
  return withSourceAwareReadDb(dbPath, (db) => {
    const results = listSessions(db, query);
    const selector = query.selector ?? null;
    const coverage = buildCoverageStatus(db, selector);
    return {
      query,
      results,
      coverage,
      nextAction: results.length === 0 ? buildZeroResultsNextAction(selector, "this command") : undefined,
    };
  });
}
