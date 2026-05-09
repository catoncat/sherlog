import { opendir, stat, open } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { canonicalizeSelector, selectorContainsFile } from "./selector";
import type {
  DateRange,
  Selector,
  SourceFileMeta,
  SourceInventory,
  SourceInventoryCwdGroup,
  SourceSnapshot,
} from "./types";

const CWD_SCAN_BYTES = 64 * 1024;

interface CollectSourceFilesOptions {
  strict?: boolean;
  requireCwdMetadata?: boolean;
}

export class SourceInventoryError extends Error {
  readonly path: string;

  constructor(path: string, operation: string, cause: unknown) {
    super(`${operation} failed for ${path}: ${describeError(cause)}`);
    this.name = "SourceInventoryError";
    this.path = path;
  }
}

export async function collectSourceInventory(root: string): Promise<SourceInventory> {
  const resolvedRoot = resolve(root);
  const files = await collectSourceFiles(resolvedRoot);
  return {
    root: resolvedRoot,
    totalFiles: files.length,
    pathDateRange: dateRange(files.map((file) => file.pathDate)),
    cwdGroups: buildCwdGroups(files),
  };
}

export async function collectSourceSnapshot(selector: Selector, options: CollectSourceFilesOptions = {}): Promise<SourceSnapshot> {
  const canonical = canonicalizeSelector(selector);
  const allFiles = await collectSourceFiles(canonical.root, {
    ...options,
    requireCwdMetadata: options.requireCwdMetadata ?? (canonical.kind === "cwd" || canonical.kind === "cwd_date_range"),
  });
  const files = allFiles.filter((file) => selectorContainsFile(canonical, file));
  return {
    selector: canonical,
    fingerprint: fingerprintFiles(canonical.root, files),
    fileCount: files.length,
    files,
  };
}

export async function collectSourceFiles(root: string, options: CollectSourceFilesOptions = {}): Promise<SourceFileMeta[]> {
  const files: SourceFileMeta[] = [];
  await walkAsync(resolve(root), files, options);
  files.sort((a, b) => a.filePath.localeCompare(b.filePath));
  return files;
}

export function extractPathDate(filePath: string): string | null {
  const pathMatch = filePath.match(/(?:^|\/)(\d{4})\/(\d{2})\/(\d{2})(?:\/|$)/);
  if (pathMatch) return `${pathMatch[1]}-${pathMatch[2]}-${pathMatch[3]}`;
  const nameMatch = filePath.match(/rollout-(\d{4})-(\d{2})-(\d{2})T/);
  if (nameMatch) return `${nameMatch[1]}-${nameMatch[2]}-${nameMatch[3]}`;
  return null;
}

async function walkAsync(currentDir: string, files: SourceFileMeta[], options: CollectSourceFilesOptions): Promise<void> {
  let dirHandle;
  try {
    dirHandle = await opendir(currentDir);
  } catch (error) {
    if (options.strict) throw new SourceInventoryError(currentDir, "read directory", error);
    return;
  }

  // OPTIMIZATION: Process directory entries sequentially using `for await`.
  // Avoids unbounded concurrency (like `Promise.all` over an array of async tasks)
  // that would trigger EMFILE errors on massive directory trees while
  // keeping the Node event loop responsive.
  for await (const entry of dirHandle) {
    const fullPath = `${currentDir}/${entry.name}`;
    if (entry.isDirectory()) {
      await walkAsync(fullPath, files, options);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

    try {
      const stats = await stat(fullPath);
      const cwd = await readCwdMetadataAsync(fullPath, options);
      files.push({
        filePath: fullPath,
        pathDate: extractPathDate(fullPath),
        cwd,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      });
    } catch (error) {
      if (options.strict) throw error instanceof SourceInventoryError ? error : new SourceInventoryError(fullPath, "stat file", error);
      continue;
    }
  }
}

async function readCwdMetadataAsync(filePath: string, options: CollectSourceFilesOptions): Promise<string> {
  let fh = null;
  try {
    fh = await open(filePath, "r");
    const buffer = Buffer.allocUnsafe(CWD_SCAN_BYTES);
    const { bytesRead } = await fh.read(buffer, 0, CWD_SCAN_BYTES, 0);
    const prefix = buffer.subarray(0, bytesRead).toString("utf8");
    let cursor = 0;
    while (cursor < prefix.length) {
      let end = prefix.indexOf("\n", cursor);
      if (end === -1) end = prefix.length;

      const rawLine = prefix.slice(cursor, end);
      cursor = end + 1;

      // Fast path: avoid JSON.parse on lines that clearly aren't cwd events
      if (!rawLine.includes('"session_meta"') && !rawLine.includes('"turn_context"')) continue;

      const line = rawLine.trim();
      if (!line) continue;

      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const payload = isRecord(record.payload) ? record.payload : null;
      if (!payload) continue;
      if ((record.type === "session_meta" || record.type === "turn_context") && typeof payload.cwd === "string") {
        return payload.cwd;
      }
    }
  } catch (error) {
    if (options.strict && options.requireCwdMetadata) throw new SourceInventoryError(filePath, "read cwd metadata", error);
    return "";
  } finally {
    if (fh !== null) {
      try {
        await fh.close();
      } catch (err) {
        console.warn(`Failed to close file ${filePath} during inventory scan:`, err);
      }
    }
  }
  return "";
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
  // OPTIMIZATION: Track min/max in a single O(N) pass.
  // Avoids O(N) array allocation from filter() and O(N log N) overhead from sort()
  // for a pure aggregation over ISO 8601 date strings.
  let from: string | null = null;
  let to: string | null = null;

  for (const value of values) {
    if (!value) continue;
    if (!from || value < from) from = value;
    if (!to || value > to) to = value;
  }

  return { from, to };
}

function fingerprintFiles(root: string, files: SourceFileMeta[]): string {
  const hash = createHash("sha256");
  const resolvedRoot = resolve(root);
  hash.update(resolvedRoot);

  // OPTIMIZATION: Avoid using `node:path`'s `relative()` function in a loop over large datasets.
  // Pre-calculate the root prefix with a trailing separator and use `String.prototype.slice()`
  // to extract relative paths.
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  const rootPrefixLen = rootPrefix.length;

  for (const file of files) {
    hash.update("\0");
    const relPath = file.filePath.startsWith(rootPrefix)
      ? file.filePath.slice(rootPrefixLen)
      : relative(root, file.filePath);
    hash.update(relPath);
    hash.update("\0");
    hash.update(String(file.mtimeMs));
    hash.update("\0");
    hash.update(String(file.size));
    hash.update("\0");
    hash.update(file.pathDate ?? "");
    hash.update("\0");
    hash.update(file.cwd);
  }
  return hash.digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
