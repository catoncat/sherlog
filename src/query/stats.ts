import { statSync } from "node:fs";
import { getStatsCounts, getTopCwds, listCoverageRecords, withSourceAwareReadDb } from "../db";
import { INDEX_VERSION } from "../env";
import { DEFAULT_SESSION_SOURCE_ID, type SessionSourceId, type StatsSummary } from "../types";

export function collectStats(dbPath: string, sourceId: SessionSourceId = DEFAULT_SESSION_SOURCE_ID): StatsSummary {
  const { counts, topCwds, coverage } = withSourceAwareReadDb(dbPath, (db) => ({
    counts: getStatsCounts(db, sourceId),
    topCwds: getTopCwds(db, 10, sourceId),
    coverage: listCoverageRecords(db, sourceId),
  }));

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(dbPath).size;
  } catch {
    dbSizeBytes = 0;
  }

  return {
    sessionCount: counts.sessionCount,
    messageCount: counts.messageCount,
    earliestStartedAt: counts.earliestStartedAt,
    latestEndedAt: counts.latestEndedAt,
    topCwds,
    indexVersion: INDEX_VERSION,
    dbPath,
    dbSizeBytes,
    lastSyncAt: counts.lastSyncAt,
    coverage,
  };
}
