import { existsSync, statSync } from "node:fs";
import { INDEX_VERSION, DEFAULT_DB_PATH } from "./env";
import { getStatsCounts, listCoverageRecords, withReadDb, type Db } from "./db";
import { evaluateCoverageRecord, evaluateRequestedCoverage } from "./coverage-freshness";
import { selectorSource } from "./selector";
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
    const context = await getContext(selectorSource(record.selector), record.selector.root);
    const snapshot = await context.source.snapshotFromFiles(record.selector, context.files);
    coverageStatus.push(evaluateCoverageRecord(record, snapshot));
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
    const context = await getContext(selectorSource(options.selector), options.selector.root);
    const snapshot = await context.source.snapshotFromFiles(options.selector, context.files);
    summary.requestedCoverage = evaluateRequestedCoverage(snapshot, coverageStatus);
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
