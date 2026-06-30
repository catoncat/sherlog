import { existsSync, statSync } from "node:fs";
import { INDEX_VERSION, DEFAULT_DB_PATH, isCurrentIndexVersion } from "./env";
import { getStatsCounts, listCoverageRecords, withReadDb, type Db } from "./db";
import { selectorImplies, selectorSource } from "./selector";
import { getSessionSourceAdapter } from "./sources";
import type { SessionSourceAdapter } from "./sources/types";
import type {
  CoverageInventoryStatus,
  CoverageRecord,
  RequestedCoverageStatus,
  Selector,
  SessionSourceId,
  SourceFileMeta,
  SourceInventory,
  StatusSummary,
} from "./types";

export async function collectStatus(options: { sourceId?: SessionSourceId; rootDir?: string; dbPath?: string; cwd?: string; selector?: Selector } = {}): Promise<StatusSummary> {
  const source = getSessionSourceAdapter(options.sourceId ?? "codex");
  const root = source.resolveRoot(options.rootDir);
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const contextCache = new Map<string, Promise<StatusSourceContext>>();
  const getContext = (sourceId: SessionSourceId, rootDir: string) =>
    getStatusSourceContext(contextCache, sourceId, rootDir);
  const sourceInventory = (await getContext(source.id, root)).inventory;
  const index = collectIndexStatus(dbPath);
  const coverage = existsSync(dbPath) ? withReadDb(dbPath, (db) => listCoverageRecordsForStatus(db, source.id)) : [];
  const coverageStatus: CoverageInventoryStatus[] = [];
  for (const record of coverage) {
    coverageStatus.push(await toCoverageInventoryStatus(record, getContext));
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
    summary.requestedCoverage = await requestedCoverageStatus(options.selector, coverageStatus, getContext);
  }
  return summary;
}

interface StatusSourceContext {
  source: SessionSourceAdapter;
  files: SourceFileMeta[];
  inventory: SourceInventory;
}

function statusSourceCacheKey(sourceId: SessionSourceId, root: string): string {
  return `${sourceId}\0${root}`;
}

function getStatusSourceContext(
  cache: Map<string, Promise<StatusSourceContext>>,
  sourceId: SessionSourceId,
  rootDir: string,
): Promise<StatusSourceContext> {
  const source = getSessionSourceAdapter(sourceId);
  const root = source.resolveRoot(rootDir);
  const key = statusSourceCacheKey(source.id, root);
  let context = cache.get(key);
  if (!context) {
    context = (async () => {
      const files = await source.collectFiles(root);
      return {
        source,
        files,
        inventory: await source.inventoryFromFiles(root, files),
      };
    })();
    cache.set(key, context);
  }
  return context;
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

async function toCoverageInventoryStatus(
  record: CoverageRecord,
  getContext: (sourceId: SessionSourceId, root: string) => Promise<StatusSourceContext>,
): Promise<CoverageInventoryStatus> {
  const context = await getContext(selectorSource(record.selector), record.selector.root);
  const snapshot = await context.source.snapshotFromFiles(record.selector, context.files);
  const fresh = snapshot.fingerprint === record.sourceFingerprint
    && (record.sourceFileSetFingerprint === "" || snapshot.fileSetFingerprint === record.sourceFileSetFingerprint)
    && snapshot.fileCount === record.sourceFileCount
    && isCurrentIndexVersion(record.indexVersion);
  const staleReason: CoverageInventoryStatus["staleReason"] = fresh
    ? "none"
    : record.sourceFileSetFingerprint !== "" && snapshot.fileSetFingerprint === record.sourceFileSetFingerprint
      ? "source_content_changed"
      : "source_set_changed";
  const advisory = !fresh && isAdvisorySourceContentStale(record.selector, staleReason);
  return {
    ...record,
    freshness: fresh ? "fresh" : "stale",
    staleReason,
    advisory,
    currentSourceFingerprint: snapshot.fingerprint,
    currentSourceFileSetFingerprint: snapshot.fileSetFingerprint,
    currentSourceFileCount: snapshot.fileCount,
  };
}

async function requestedCoverageStatus(
  selector: Selector,
  coverage: CoverageInventoryStatus[],
  getContext: (sourceId: SessionSourceId, root: string) => Promise<StatusSourceContext>,
): Promise<RequestedCoverageStatus> {
  const context = await getContext(selectorSource(selector), selector.root);
  const snapshot = await context.source.snapshotFromFiles(selector, context.files);
  const coveringSelectors = coverage.filter((entry) =>
    isCurrentIndexVersion(entry.indexVersion) && selectorImplies(entry.selector, selector)
  );
  const hasFreshCovering = coveringSelectors.some((entry) => entry.freshness === "fresh");
  const freshness: RequestedCoverageStatus["freshness"] = hasFreshCovering
    ? "fresh"
    : coveringSelectors.length > 0
      ? "stale"
      : "missing";
  const staleReason = requestedCoverageStaleReason(freshness, coveringSelectors);
  return {
    requested: snapshot.selector,
    complete: freshness === "fresh",
    freshness,
    staleReason,
    sourceFingerprint: snapshot.fingerprint,
    sourceFileSetFingerprint: snapshot.fileSetFingerprint,
    sourceFileCount: snapshot.fileCount,
    coveringSelectors,
    recommendedAction: freshness === "fresh" || isAdvisorySourceContentStale(snapshot.selector, staleReason) ? "query" : "sync",
  };
}

function isAdvisorySourceContentStale(
  selector: Selector,
  staleReason: RequestedCoverageStatus["staleReason"],
): boolean {
  return selectorSource(selector) === "codex" && staleReason === "source_content_changed";
}

function requestedCoverageStaleReason(
  freshness: RequestedCoverageStatus["freshness"],
  coveringSelectors: CoverageInventoryStatus[],
): RequestedCoverageStatus["staleReason"] {
  if (freshness === "fresh") return "none";
  if (freshness === "missing") return "missing";
  return coveringSelectors.some((entry) =>
    entry.sourceFileSetFingerprint !== "" && entry.currentSourceFileSetFingerprint === entry.sourceFileSetFingerprint
  )
    ? "source_content_changed"
    : "source_set_changed";
}
