import { createHash } from "node:crypto";
import { opendir, open, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { canonicalizeSelector, selectorContainsFile, selectorSource } from "../selector";
import type {
  DateRange,
  Selector,
  SourceFileMeta,
  SourceInventory,
  SourceInventoryCwdGroup,
  SourceSnapshot,
} from "../types";
import { SourceInventoryError } from "./codex-inventory";
import { acceptedPiCompactionRecord, acceptedPiMessageRecord, acceptedPiSessionRecord, timestampDate } from "./pi-policy";

const METADATA_SCAN_BYTES = 64 * 1024;

interface PiSourceFileMeta extends SourceFileMeta {
  acceptedFingerprint: string;
}

interface CollectSourceFilesOptions {
  strict?: boolean;
}

export async function collectPiSourceInventory(root: string): Promise<SourceInventory> {
  const resolvedRoot = resolve(root);
  const files = await collectPiSourceFiles(resolvedRoot);
  return {
    root: resolvedRoot,
    totalFiles: files.length,
    pathDateRange: dateRange(files.map((file) => file.pathDate)),
    cwdGroups: buildCwdGroups(files),
  };
}

export async function collectPiSourceSnapshot(selector: Selector, options: CollectSourceFilesOptions = {}): Promise<SourceSnapshot> {
  const canonical = canonicalizeSelector(selector, { defaultSource: "pi" });
  assertPiSelector(canonical);
  const allFiles = await collectPiSourceFiles(canonical.root, options);
  const files = allFiles.filter((file) => selectorContainsFile(canonical, file));
  return {
    selector: canonical,
    fingerprint: fingerprintFiles(canonical.root, files),
    fileCount: files.length,
    files,
  };
}

export async function collectPiSourceFiles(root: string, options: CollectSourceFilesOptions = {}): Promise<PiSourceFileMeta[]> {
  const files: PiSourceFileMeta[] = [];
  await walkAsync(resolve(root), files, options);
  files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return files;
}

function assertPiSelector(selector: Selector): void {
  const source = selectorSource(selector);
  if (source !== "pi") {
    throw new Error("selector.source must match session source pi");
  }
}

async function walkAsync(currentDir: string, files: PiSourceFileMeta[], options: CollectSourceFilesOptions): Promise<void> {
  let dirHandle;
  try {
    dirHandle = await opendir(currentDir);
  } catch (error) {
    if (options.strict) throw new SourceInventoryError(currentDir, "read directory", error);
    return;
  }

  for await (const entry of dirHandle) {
    const fullPath = `${currentDir}/${entry.name}`;
    if (entry.isDirectory()) {
      await walkAsync(fullPath, files, options);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

    try {
      const metadata = await readAcceptedMetadataAsync(fullPath);
      if (!metadata) continue;
      const stats = await stat(fullPath);
      files.push({
        filePath: fullPath,
        pathDate: metadata.pathDate,
        cwd: metadata.cwd,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
        acceptedFingerprint: metadata.acceptedFingerprint,
      });
    } catch (error) {
      if (options.strict) throw error instanceof SourceInventoryError ? error : new SourceInventoryError(fullPath, "stat file", error);
    }
  }
}

async function readAcceptedMetadataAsync(filePath: string): Promise<{ cwd: string; pathDate: string | null; acceptedFingerprint: string } | null> {
  let cwd = "";
  let pathDate: string | null = null;
  let acceptedCount = 0;
  const hash = createHash("sha256");
  let fh = null;

  try {
    fh = await open(filePath, "r");
    const buffer = Buffer.allocUnsafe(METADATA_SCAN_BYTES);
    const { bytesRead } = await fh.read(buffer, 0, METADATA_SCAN_BYTES, 0);
    const prefix = buffer.subarray(0, bytesRead).toString("utf8");
    let cursor = 0;
    while (cursor < prefix.length) {
      let end = prefix.indexOf("\n", cursor);
      if (end === -1) end = prefix.length;

      const line = prefix.slice(cursor, end).trim();
      cursor = end + 1;
      if (!line) continue;

      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      const session = acceptedPiSessionRecord(record);
      if (session) {
        if (!cwd && session.cwd) cwd = session.cwd;
        if (!pathDate && session.timestamp) pathDate = timestampDate(session.timestamp);
        hash.update("\0session\0");
        hash.update(session.sessionId);
        hash.update("\0");
        hash.update(session.cwd);
        hash.update("\0");
        hash.update(session.timestamp);
        continue;
      }

      const message = acceptedPiMessageRecord(record);
      if (message) {
        acceptedCount += 1;
        if (!pathDate && message.timestamp) pathDate = timestampDate(message.timestamp);
        hash.update("\0message\0");
        hash.update(message.role);
        hash.update("\0");
        hash.update(message.timestamp);
        hash.update("\0");
        hash.update(message.contentText);
        continue;
      }

      const compaction = acceptedPiCompactionRecord(record);
      if (compaction) {
        acceptedCount += 1;
        if (!pathDate && compaction.timestamp) pathDate = timestampDate(compaction.timestamp);
        hash.update("\0compaction\0");
        hash.update(compaction.timestamp);
        hash.update("\0");
        hash.update(compaction.summaryText);
      }
    }
  } catch {
    return null;
  } finally {
    if (fh !== null) {
      try {
        await fh.close();
      } catch {
        // Best-effort metadata scan; parser/sync handles real file errors.
      }
    }
  }

  if (acceptedCount === 0) return null;
  return { cwd, pathDate, acceptedFingerprint: hash.digest("hex") };
}

function buildCwdGroups(files: SourceFileMeta[]): SourceInventoryCwdGroup[] {
  const groups = new Map<string, SourceFileMeta[]>();
  for (const file of files) {
    if (!file.cwd) continue;
    const group = groups.get(file.cwd) ?? [];
    group.push(file);
    groups.set(file.cwd, group);
  }
  return [...groups.entries()]
    .map(([cwd, groupFiles]) => ({
      cwd,
      fileCount: groupFiles.length,
      pathDateRange: dateRange(groupFiles.map((file) => file.pathDate)),
    }))
    .sort((a, b) => b.fileCount - a.fileCount || a.cwd.localeCompare(b.cwd));
}

function dateRange(values: Array<string | null>): DateRange {
  let from: string | null = null;
  let to: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!from || value < from) from = value;
    if (!to || value > to) to = value;
  }
  return { from, to };
}

function fingerprintFiles(root: string, files: PiSourceFileMeta[]): string {
  const hash = createHash("sha256");
  const resolvedRoot = resolve(root);
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  hash.update(resolvedRoot);

  for (const file of files) {
    hash.update("\0");
    hash.update(file.filePath.slice(rootPrefix.length));
    hash.update("\0");
    hash.update(file.pathDate ?? "");
    hash.update("\0");
    hash.update(file.cwd);
    hash.update("\0");
    hash.update(file.acceptedFingerprint);
  }

  return hash.digest("hex");
}
