import { existsSync, statSync } from "node:fs";
import { collectSourceInventory, collectSourceSnapshot } from "./source-inventory";
import { INDEX_VERSION, DEFAULT_DB_PATH, resolveCodexDir } from "./env";
import { getStatsCounts, listCoverageRecords, withReadDb } from "./db";
import { selectorImplies } from "./selector";
import type { CoverageInventoryStatus, CoverageRecord, RequestedCoverageStatus, Selector, StatusSummary } from "./types";

export async function collectStatus(options: { rootDir?: string; dbPath?: string; cwd?: string; selector?: Selector } = {}): Promise<StatusSummary> {
  const root = resolveCodexDir(options.rootDir);
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const sourceInventory = await collectSourceInventory(root);
  const index = collectIndexStatus(dbPath);
  const coverage = existsSync(dbPath) ? withReadDb(dbPath, (db) => listCoverageRecords(db)) : [];
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

  const counts = withReadDb(dbPath, (db) => getStatsCounts(db));
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

async function toCoverageInventoryStatus(record: CoverageRecord): Promise<CoverageInventoryStatus> {
  const snapshot = await collectSourceSnapshot(record.selector);
  const fresh = snapshot.fingerprint === record.sourceFingerprint
    && snapshot.fileCount === record.sourceFileCount
    && record.indexVersion === INDEX_VERSION;
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
  const snapshot = await collectSourceSnapshot(selector);
  const coveringSelectors = coverage.filter((entry) =>
    entry.indexVersion === INDEX_VERSION && selectorImplies(entry.selector, selector)
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
