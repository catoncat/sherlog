import { existsSync, statSync } from "node:fs";
import { INDEX_VERSION, DEFAULT_DB_PATH, isCurrentIndexVersion } from "./env";
import { getStatsCounts, listCoverageRecords, withReadDb, type Db } from "./db";
import { selectorImplies, selectorSource } from "./selector";
import { getSessionSourceAdapter } from "./sources";
import type { CoverageInventoryStatus, CoverageRecord, RequestedCoverageStatus, Selector, SessionSourceId, StatusSummary } from "./types";

export async function collectStatus(options: { sourceId?: SessionSourceId; rootDir?: string; dbPath?: string; cwd?: string; selector?: Selector } = {}): Promise<StatusSummary> {
  const source = getSessionSourceAdapter(options.sourceId ?? "codex");
  const root = source.resolveRoot(options.rootDir);
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const sourceInventory = await source.collectInventory(root);
  const index = collectIndexStatus(dbPath);
  const coverage = existsSync(dbPath) ? withReadDb(dbPath, (db) => listCoverageRecordsForStatus(db, source.id)) : [];
  const coverageStatus: CoverageInventoryStatus[] = [];
  for (const record of coverage) {
    coverageStatus.push(await toCoverageInventoryStatus(record));
  }
  const summary: StatusSummary = {
    context: {
      cwd: options.cwd ?? process.cwd(),
      root,
      dbPath,
      indexVersion: INDEX_VERSION,
    },
    sourceInventory,
    index,
    coverage: coverageStatus,
  };
  if (options.selector) {
    summary.requestedCoverage = await requestedCoverageStatus(options.selector, coverageStatus);
  }
  return summary;
}

function collectIndexStatus(dbPath: string): StatusSummary["index"] {
  if (!existsSync(dbPath)) {
    return {
      exists: false,
      sessionCount: 0,
      messageCount: 0,
      earliestStartedAt: null,
      latestEndedAt: null,
      dbSizeBytes: 0,
      lastSyncAt: null,
    };
  }

  const counts = withReadDb(dbPath, (db) => {
    if (!tableExists(db, "sessions")) return emptyIndexCounts();
    if (!tableColumnExists(db, "sessions", "source_id")) return getLegacyCodexStatsCounts(db);
    return getStatsCounts(db);
  });
  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(dbPath).size;
  } catch {
    dbSizeBytes = 0;
  }

  return {
    exists: true,
    sessionCount: counts.sessionCount,
    messageCount: counts.messageCount,
    earliestStartedAt: counts.earliestStartedAt,
    latestEndedAt: counts.latestEndedAt,
    dbSizeBytes,
    lastSyncAt: counts.lastSyncAt,
  };
}

function listCoverageRecordsForStatus(db: Db, sourceId: SessionSourceId): CoverageRecord[] {
  if (!tableColumnExists(db, "coverage", "source_id")) return [];
  return listCoverageRecords(db, sourceId);
}

function emptyIndexCounts(): ReturnType<typeof getStatsCounts> {
  return {
    sessionCount: 0,
    messageCount: 0,
    earliestStartedAt: null,
    latestEndedAt: null,
    lastSyncAt: null,
  };
}

function getLegacyCodexStatsCounts(db: Db): ReturnType<typeof getStatsCounts> {
  const row = db
    .prepare(`
      SELECT
        COUNT(*) AS sessionCount,
        COALESCE(SUM(message_count), 0) AS messageCount,
        MIN(started_at) AS earliestStartedAt,
        MAX(ended_at) AS latestEndedAt,
        MAX(updated_at) AS lastSyncAt
      FROM sessions
    `)
    .get() as ReturnType<typeof getStatsCounts>;
  return row;
}

function tableColumnExists(db: Db, tableName: string, columnName: string): boolean {
  return db
    .prepare<[string, string], { name: string }>(`
      SELECT name
      FROM pragma_table_info(?)
      WHERE name = ?
      LIMIT 1
    `)
    .get(tableName, columnName) !== undefined;
}

function tableExists(db: Db, tableName: string): boolean {
  return db
    .prepare<[string], unknown>("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) !== undefined;
}

async function toCoverageInventoryStatus(record: CoverageRecord): Promise<CoverageInventoryStatus> {
  const source = getSessionSourceAdapter(selectorSource(record.selector));
  const snapshot = await source.collectSnapshot(record.selector);
  const fresh = snapshot.fingerprint === record.sourceFingerprint
    && snapshot.fileCount === record.sourceFileCount
    && isCurrentIndexVersion(record.indexVersion);
  return {
    ...record,
    freshness: fresh ? "fresh" : "stale",
    currentSourceFingerprint: snapshot.fingerprint,
    currentSourceFileCount: snapshot.fileCount,
  };
}

async function requestedCoverageStatus(
  selector: Selector,
  coverage: CoverageInventoryStatus[],
): Promise<RequestedCoverageStatus> {
  const source = getSessionSourceAdapter(selectorSource(selector));
  const snapshot = await source.collectSnapshot(selector);
  const coveringSelectors = coverage.filter((entry) =>
    isCurrentIndexVersion(entry.indexVersion) && selectorImplies(entry.selector, selector)
  );
  const hasFreshCovering = coveringSelectors.some((entry) => entry.freshness === "fresh");
  const freshness: RequestedCoverageStatus["freshness"] = hasFreshCovering
    ? "fresh"
    : coveringSelectors.length > 0
      ? "stale"
      : "missing";
  return {
    requested: snapshot.selector,
    complete: freshness === "fresh",
    freshness,
    sourceFingerprint: snapshot.fingerprint,
    sourceFileCount: snapshot.fileCount,
    coveringSelectors,
    recommendedAction: freshness === "fresh" ? "query" : "sync",
  };
}
