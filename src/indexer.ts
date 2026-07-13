import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { DEFAULT_DB_PATH, INDEX_VERSION, ensureDataDir, isCurrentIndexVersion } from "./env";
import {
  coldRootsPathForDb,
  listColdPresentNativeSessionIds,
  listColdRootPaths,
} from "./cold-roots";
import {
  cleanupMismatchedMessagesForSelector,
  countSessionsForSelector,
  deleteSessionsForSelectorExceptFilePaths,
  deleteSessionByFilePath,
  getIndexedSessionMeta,
  getIndexedSessionMetas,
  getIndexedSessionProjection,
  openWriteDb,
  replaceCoverage,
  replaceSession,
} from "./db";
import { canonicalizeSelector, selectorSource } from "./selector";
import { getSessionSourceAdapter } from "./sources";
import { SourceInventoryError } from "./source-inventory";
import { withSyncLock } from "./sync-lock";
import type { CoverageWriteSummary, ParsedSession, ParseSessionResult, Selector, SessionSourceId, SourceFileMeta, SyncErrorDetail, SyncSummary } from "./types";

interface SyncOptions {
  dbPath?: string;
  rootDir?: string;
  sourceId?: SessionSourceId;
  selector?: Selector;
  bestEffort?: boolean;
  prune?: boolean;
  /** Extra cold roots for this run only (merged with registered cold roots). */
  coldRoots?: string[];
}

type SyncOperation =
  | {
      kind: "replace";
      filePath: string;
      session: ParsedSession;
      rawFileMtime: number;
      rawFileSize: number;
      pathDate: string;
      isUpdate: boolean;
    }
  | {
      kind: "filtered";
      filePath: string;
    };

export class SyncError extends Error {
  summary: SyncSummary;

  constructor(summary: SyncSummary) {
    super(buildSyncErrorMessage(summary));
    this.name = "SyncError";
    this.summary = summary;
  }
}

export async function syncSessions(options: SyncOptions = {}): Promise<SyncSummary> {
  ensureDataDir();
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const source = getSessionSourceAdapter(options.sourceId ?? "codex");
  const selector = canonicalizeSelector(
    options.selector ?? { source: source.id, kind: "all", root: source.resolveRoot(options.rootDir) },
    { defaultSource: source.id },
  );
  assertSelectorSourceMatches(selector, source.id);
  return withSyncLock(dbPath, async () => {
    let sourceSnapshot;
    try {
      sourceSnapshot = await source.collectSnapshot(selector, { strict: true });
    } catch (error) {
      const summary = sourceUnavailableSummary(selector, error);
      throw new SyncError(summary);
    }
    const db = openWriteDb(dbPath);
    const operations: SyncOperation[] = [];
    const unchangedFilePaths = new Set<string>();
    const readResults = new Map<string, ParseSessionResult>();

    const summary: SyncSummary = {
      scanned: sourceSnapshot.fileCount,
      added: 0,
      updated: 0,
      skipped: 0,
      filtered: 0,
      removed: 0,
      retainedCold: 0,
      errors: 0,
      errorDetails: [],
      selector,
      coverage: skippedCoverage(selector, sourceSnapshot.fingerprint, sourceSnapshot.fileSetFingerprint, sourceSnapshot.fileCount, "not_written"),
    };

    try {
      await collectSyncOperations(
        source,
        db,
        sourceSnapshot.files,
        operations,
        unchangedFilePaths,
        readResults,
        summary
      );

      if (summary.errors > 0 && !options.bestEffort) {
        throw new SyncError(summary);
      }

      let sourceContentChanged = false;
      let activeSourceDeferred = false;
      if (!options.bestEffort) {
        let afterSnapshot;
        try {
          afterSnapshot = await source.collectSnapshot(selector, { strict: true });
        } catch (error) {
          recordSyncError(summary, sourceErrorPath(selector, error), error);
          throw new SyncError(summary);
        }
        if (afterSnapshot.fingerprint !== sourceSnapshot.fingerprint) {
          const change = await classifyCodexSourceChange(
            source,
            db,
            sourceSnapshot,
            afterSnapshot,
            readResults,
          );
          sourceContentChanged = change.kind === "append";
          activeSourceDeferred = change.kind === "deferred";
          if (change.kind === "reject") {
            recordSyncError(summary, "(selector)", new Error("source changed during strict sync"));
            throw new SyncError(summary);
          }
          if (change.kind === "deferred") removeOperationsForPaths(operations, change.filePaths);
        }
      }

      const bestEffort = Boolean(options.bestEffort);
      const retainedFilePaths = retainedIndexedFilePaths(unchangedFilePaths, operations);
      const retainedNativeSessionIds = Boolean(options.prune)
        ? coldPresentNativeSessionIds(dbPath, source.id, options.coldRoots)
        : new Set<string>();
      summary.coverage = applyOperations(
        db,
        operations,
        summary,
        bestEffort,
        Boolean(options.prune),
        selector,
        sourceSnapshot,
        retainedFilePaths,
        retainedNativeSessionIds,
        !activeSourceDeferred,
      );
      if (sourceContentChanged && summary.coverage.written) {
        summary.coverage.staleReason = "source_content_changed";
        summary.coverage.recommendedAction = "query";
      }
      if (activeSourceDeferred) {
        summary.coverage.reason = "active_source_deferred";
        summary.coverage.recommendedAction = "sync";
      }
      if (summary.errors > 0 && !options.bestEffort) {
        throw new SyncError(summary);
      }

      return summary;
    } finally {
      db.close();
    }
  });
}

function assertSelectorSourceMatches(selector: Selector, sourceId: SessionSourceId): void {
  const actualSource = selectorSource(selector);
  if (actualSource !== sourceId) {
    throw new Error(`selector.source must match session source ${sourceId}`);
  }
}

async function collectSyncOperations(
  source: ReturnType<typeof getSessionSourceAdapter>,
  db: ReturnType<typeof openWriteDb>,
  files: readonly SourceFileMeta[],
  operations: SyncOperation[],
  unchangedFilePaths: Set<string>,
  readResults: Map<string, ParseSessionResult>,
  summary: SyncSummary
): Promise<void> {
  // Pre-fetch indexed session metadata for all files using batching to avoid N+1 queries
  const filePaths = files.map((f) => f.filePath);
  const indexedMetas = getIndexedSessionMetas(db, filePaths, selectorSource(summary.selector));

  // OPTIMIZATION: Parse codex sessions concurrently to avoid I/O bottlenecks.
  // We use a worker loop pattern to bound concurrency and prevent EMFILE errors.
  const CONCURRENCY_LIMIT = 16;
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < files.length) {
      const file = files[currentIndex++];
      const filePath = file.filePath;
      try {
        const indexed = indexedMetas.get(filePath) ?? null;
        if (isUnchanged(indexed, file.mtimeMs, file.size)) {
          summary.skipped += 1;
          unchangedFilePaths.add(filePath);
          continue;
        }

        const parsed = await source.parseFile(file);
        readResults.set(filePath, parsed);
        if (parsed.kind === "filtered") {
          operations.push({ kind: "filtered", filePath });
          continue;
        }
        if (parsed.kind === "skipped") {
          summary.skipped += 1;
          continue;
        }

        operations.push({
          kind: "replace",
          filePath,
          session: parsed.session,
          rawFileMtime: file.mtimeMs,
          rawFileSize: file.size,
          pathDate: file.pathDate ?? "",
          isUpdate: Boolean(indexed),
        });
      } catch (error) {
        recordSyncError(summary, filePath, error);
      }
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, files.length) }, () => worker());
  await Promise.all(workers);
}

type CodexSourceChange =
  | { kind: "append" }
  | { kind: "deferred"; filePaths: Set<string> }
  | { kind: "reject" };

async function classifyCodexSourceChange(
  source: ReturnType<typeof getSessionSourceAdapter>,
  db: ReturnType<typeof openWriteDb>,
  before: { fileSetFingerprint: string; fileCount: number; files: SourceFileMeta[] },
  after: { fileSetFingerprint: string; fileCount: number; files: SourceFileMeta[] },
  readResults: Map<string, ParseSessionResult>,
): Promise<CodexSourceChange> {
  if (source.id !== "codex") return { kind: "reject" };
  if (after.fileCount !== before.fileCount || after.fileSetFingerprint !== before.fileSetFingerprint) return { kind: "reject" };

  const afterByPath = new Map(after.files.map((file) => [file.filePath, file]));
  const deferred = new Set<string>();
  for (const beforeFile of before.files) {
    const afterFile = afterByPath.get(beforeFile.filePath);
    if (!afterFile) return { kind: "reject" };
    if (sameSourceFileMeta(beforeFile, afterFile)) continue;
    if (afterFile.size <= beforeFile.size) return { kind: "reject" };

    const hadReadResult = readResults.has(beforeFile.filePath);
    const parsed = readResults.get(beforeFile.filePath) ?? await source.parseFile(beforeFile);
    const proof = parsed.sourceRead;
    if (!proof || proof.byteCount !== beforeFile.size) return { kind: "reject" };
    if (await fingerprintFilePrefix(beforeFile.filePath, beforeFile.size) !== proof.contentFingerprint) return { kind: "reject" };
    const projection = indexedProjectionAppendStatus(db, beforeFile.filePath, parsed, !hadReadResult);
    const changedBeforeRead = proof.openedMtimeMs !== beforeFile.mtimeMs || proof.openedSize !== beforeFile.size;
    const changedDuringRead = proof.completedMtimeMs !== proof.openedMtimeMs || proof.completedSize !== proof.openedSize;
    if (projection === "missing" && (changedBeforeRead || changedDuringRead)) {
      deferred.add(beforeFile.filePath);
      continue;
    }
    if (projection === "unsafe") return { kind: "reject" };
  }
  return deferred.size > 0 ? { kind: "deferred", filePaths: deferred } : { kind: "append" };
}

function removeOperationsForPaths(operations: SyncOperation[], filePaths: Set<string>): void {
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    if (filePaths.has(operations[index].filePath)) operations.splice(index, 1);
  }
}

function sameSourceFileMeta(left: SourceFileMeta, right: SourceFileMeta): boolean {
  return left.mtimeMs === right.mtimeMs
    && left.size === right.size
    && left.pathDate === right.pathDate
    && left.cwd === right.cwd;
}

async function fingerprintFilePrefix(filePath: string, byteCount: number): Promise<string> {
  const hash = createHash("sha256");
  if (byteCount === 0) return hash.digest("hex");
  let read = 0;
  for await (const chunk of createReadStream(filePath, { start: 0, end: byteCount - 1 })) {
    hash.update(chunk as Buffer);
    read += (chunk as Buffer).length;
  }
  if (read !== byteCount) return "";
  return hash.digest("hex");
}

function indexedProjectionAppendStatus(
  db: ReturnType<typeof openWriteDb>,
  filePath: string,
  parsed: ParseSessionResult,
  requireExact: boolean,
): "safe" | "unsafe" | "missing" {
  const existing = getIndexedSessionProjection(db, filePath, "codex");
  if (!existing) return "missing";
  if (parsed.kind !== "parsed" || parsed.session.sessionUuid !== existing.sessionUuid) return "unsafe";

  const messages = existing.messages;
  const candidate = parsed.session;
  if (candidate.messages.length < messages.length) return "unsafe";
  for (let index = 0; index < messages.length; index += 1) {
    const left = messages[index];
    const right = candidate.messages[index];
    if (
      left.seq !== right.seq
      || left.role !== right.role
      || left.contentText !== right.contentText
      || left.timestamp !== right.timestamp
      || left.sourceKind !== right.sourceKind
    ) return "unsafe";
  }
  if (candidate.title !== existing.title || candidate.cwd !== existing.cwd || candidate.startedAt !== existing.startedAt) return "unsafe";
  if (!candidate.compactText.startsWith(existing.compactText) || !candidate.reasoningSummaryText.startsWith(existing.reasoningSummaryText)) return "unsafe";
  if (!requireExact) return "safe";
  return candidate.messages.length === messages.length
    && candidate.summaryText === existing.summaryText
    && candidate.compactText === existing.compactText
    && candidate.reasoningSummaryText === existing.reasoningSummaryText
    && candidate.endedAt === existing.endedAt
    ? "safe"
    : "unsafe";
}

function isUnchanged(
  indexed: { rawFileMtime: number; rawFileSize: number; indexVersion: string } | null,
  mtimeMs: number,
  size: number,
): boolean {
  if (!indexed) return false;
  return indexed.rawFileMtime === mtimeMs
    && indexed.rawFileSize === size
    && isCurrentIndexVersion(indexed.indexVersion);
}

function coldPresentNativeSessionIds(
  dbPath: string,
  sourceId: SessionSourceId,
  extraColdRoots: string[] | undefined,
): Set<string> {
  const roots = new Set<string>(listColdRootPaths(coldRootsPathForDb(dbPath), sourceId));
  for (const root of extraColdRoots ?? []) {
    if (root.trim() !== "") roots.add(root);
  }
  if (roots.size === 0) return new Set();
  return listColdPresentNativeSessionIds([...roots]);
}

function applyOperations(
  db: ReturnType<typeof openWriteDb>,
  operations: SyncOperation[],
  summary: SyncSummary,
  bestEffort: boolean,
  prune: boolean,
  selector: Selector,
  sourceSnapshot: { fingerprint: string; fileSetFingerprint: string; fileCount: number },
  retainedFilePaths: Set<string>,
  retainedNativeSessionIds: Set<string>,
  writeCoverage: boolean,
): CoverageWriteSummary {
  if (bestEffort) {
    for (const operation of operations) {
      try {
        applyOperation(db, operation, undefined, selectorSource(selector));
        recordAppliedOperation(summary, operation);
      } catch (error) {
        recordSyncError(summary, operation.filePath, error);
      }
    }
    return skippedCoverage(selector, sourceSnapshot.fingerprint, sourceSnapshot.fileSetFingerprint, sourceSnapshot.fileCount, "best_effort");
  }

  let currentFilePath = "";
  let coverage: CoverageWriteSummary | null = null;
  const tx = db.transaction(() => {
    for (const operation of operations) {
      currentFilePath = operation.filePath;
      applyOperation(db, operation, selector.root, selectorSource(selector));
    }
    cleanupMismatchedMessagesForSelector(db, selector);
    if (prune) {
      const pruneResult = deleteSessionsForSelectorExceptFilePaths(
        db,
        selector,
        retainedFilePaths,
        retainedNativeSessionIds,
      );
      summary.removed += pruneResult.removed;
      summary.retainedCold += pruneResult.retainedCold;
    }
    const indexedSessionCount = countSessionsForSelector(db, selector);
    if (!writeCoverage) {
      coverage = skippedCoverage(
        selector,
        sourceSnapshot.fingerprint,
        sourceSnapshot.fileSetFingerprint,
        sourceSnapshot.fileCount,
        "active_source_deferred",
      );
      return;
    }
    const record = replaceCoverage(
      db,
      selector,
      sourceSnapshot.fingerprint,
      sourceSnapshot.fileSetFingerprint,
      sourceSnapshot.fileCount,
      indexedSessionCount,
      INDEX_VERSION,
    );
    coverage = {
      written: true,
      selector: record.selector,
      sourceFingerprint: record.sourceFingerprint,
      sourceFileSetFingerprint: record.sourceFileSetFingerprint,
      sourceFileCount: record.sourceFileCount,
      indexedSessionCount: record.indexedSessionCount,
    };
  });

  try {
    tx();
  } catch (error) {
    recordSyncError(summary, currentFilePath || "(unknown file)", error);
    throw new SyncError(summary);
  }

  for (const operation of operations) {
    recordAppliedOperation(summary, operation);
  }
  return coverage ?? skippedCoverage(selector, sourceSnapshot.fingerprint, sourceSnapshot.fileSetFingerprint, sourceSnapshot.fileCount, "not_written");
}

function applyOperation(
  db: ReturnType<typeof openWriteDb>,
  operation: SyncOperation,
  sourceRoot: string | undefined,
  sourceId: ReturnType<typeof selectorSource>,
): void {
  if (operation.kind === "filtered") {
    deleteSessionByFilePath(db, operation.filePath, sourceId);
    return;
  }

  replaceSession(
    db,
    operation.session,
    operation.rawFileMtime,
    operation.rawFileSize,
    INDEX_VERSION,
    operation.pathDate,
    sourceRoot,
  );
}

function retainedIndexedFilePaths(
  unchangedFilePaths: Set<string>,
  operations: SyncOperation[],
): Set<string> {
  const retained = new Set(unchangedFilePaths);
  for (const operation of operations) {
    if (operation.kind === "replace") {
      retained.add(operation.filePath);
    }
  }
  return retained;
}

function recordAppliedOperation(summary: SyncSummary, operation: SyncOperation): void {
  if (operation.kind === "filtered") {
    summary.filtered += 1;
    return;
  }

  if (operation.isUpdate) {
    summary.updated += 1;
    return;
  }

  summary.added += 1;
}

function recordSyncError(summary: SyncSummary, filePath: string, error: unknown): void {
  summary.errors += 1;
  summary.errorDetails.push({
    filePath,
    message: describeError(error),
  });
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function buildSyncErrorMessage(summary: SyncSummary): string {
  const details = summary.errorDetails.map((detail: SyncErrorDetail) =>
    `${detail.filePath}: ${detail.message}`
  );
  return `sync failed with ${summary.errors} error(s)\n${details.join("\n")}`;
}

function skippedCoverage(
  selector: Selector,
  sourceFingerprint: string,
  sourceFileSetFingerprint: string,
  sourceFileCount: number,
  reason: string,
): CoverageWriteSummary {
  return {
    written: false,
    selector,
    sourceFingerprint,
    sourceFileSetFingerprint,
    sourceFileCount,
    indexedSessionCount: 0,
    reason,
  };
}

function sourceUnavailableSummary(selector: Selector, error: unknown): SyncSummary {
  const summary: SyncSummary = {
    scanned: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    filtered: 0,
    removed: 0,
    retainedCold: 0,
    errors: 0,
    errorDetails: [],
    selector,
    coverage: skippedCoverage(selector, "", "", 0, "source_unavailable"),
  };
  recordSyncError(summary, sourceErrorPath(selector, error), error);
  return summary;
}

function sourceErrorPath(selector: Selector, error: unknown): string {
  return error instanceof SourceInventoryError ? error.path : selector.root;
}
