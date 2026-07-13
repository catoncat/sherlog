import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SessionSourceId } from "./types";

export const COLD_ROOTS_VERSION = 1;
export const COLD_ROOTS_FILE_NAME = "cold-roots.json";

/** Codex rollout file: rollout-<ts>-<uuid>.jsonl or .jsonl.zst */
const CODEX_COLD_FILE_RE =
  /(?:^|\/)rollout-[^/]*?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(?:\.zst)?$/i;

export interface ColdRootEntry {
  sourceId: SessionSourceId;
  root: string;
  addedAt: string;
}

export interface ColdRootsConfig {
  version: number;
  roots: ColdRootEntry[];
}

export function coldRootsPathForDb(dbPath: string): string {
  return resolve(dirname(resolve(dbPath)), COLD_ROOTS_FILE_NAME);
}

export function emptyColdRootsConfig(): ColdRootsConfig {
  return { version: COLD_ROOTS_VERSION, roots: [] };
}

export function loadColdRootsConfig(configPath: string): ColdRootsConfig {
  if (!existsSync(configPath)) return emptyColdRootsConfig();
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.roots)) return emptyColdRootsConfig();
    const roots: ColdRootEntry[] = [];
    for (const item of parsed.roots) {
      if (!isRecord(item)) continue;
      if (typeof item.root !== "string" || item.root.trim() === "") continue;
      const sourceId = typeof item.sourceId === "string" && item.sourceId.trim() !== ""
        ? (item.sourceId as SessionSourceId)
        : "codex";
      const addedAt = typeof item.addedAt === "string" && item.addedAt.trim() !== ""
        ? item.addedAt
        : new Date(0).toISOString();
      roots.push({ sourceId, root: resolve(item.root), addedAt });
    }
    return { version: COLD_ROOTS_VERSION, roots };
  } catch {
    return emptyColdRootsConfig();
  }
}

export function saveColdRootsConfig(configPath: string, config: ColdRootsConfig): void {
  const dir = dirname(resolve(configPath));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const normalized: ColdRootsConfig = {
    version: COLD_ROOTS_VERSION,
    roots: config.roots.map((entry) => ({
      sourceId: entry.sourceId,
      root: resolve(entry.root),
      addedAt: entry.addedAt,
    })),
  };
  writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function listColdRootEntries(
  configPath: string,
  sourceId?: SessionSourceId,
): ColdRootEntry[] {
  const config = loadColdRootsConfig(configPath);
  if (!sourceId) return config.roots;
  return config.roots.filter((entry) => entry.sourceId === sourceId);
}

export function listColdRootPaths(configPath: string, sourceId: SessionSourceId): string[] {
  return listColdRootEntries(configPath, sourceId).map((entry) => entry.root);
}

export function addColdRoot(
  configPath: string,
  root: string,
  sourceId: SessionSourceId = "codex",
): ColdRootEntry {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot)) {
    throw new ColdRootError(`cold root does not exist: ${resolvedRoot}`);
  }
  const st = statSync(resolvedRoot);
  if (!st.isDirectory()) {
    throw new ColdRootError(`cold root is not a directory: ${resolvedRoot}`);
  }

  const config = loadColdRootsConfig(configPath);
  const existing = config.roots.find(
    (entry) => entry.sourceId === sourceId && entry.root === resolvedRoot,
  );
  if (existing) return existing;

  const entry: ColdRootEntry = {
    sourceId,
    root: resolvedRoot,
    addedAt: new Date().toISOString(),
  };
  config.roots.push(entry);
  saveColdRootsConfig(configPath, config);
  return entry;
}

export function removeColdRoot(
  configPath: string,
  root: string,
  sourceId: SessionSourceId = "codex",
): boolean {
  const resolvedRoot = resolve(root);
  const config = loadColdRootsConfig(configPath);
  const next = config.roots.filter(
    (entry) => !(entry.sourceId === sourceId && entry.root === resolvedRoot),
  );
  if (next.length === config.roots.length) return false;
  saveColdRootsConfig(configPath, { version: COLD_ROOTS_VERSION, roots: next });
  return true;
}

/**
 * Walk cold roots and collect native session ids still present as raw or zst.
 * Codex only for now: uuid from rollout-*.jsonl(.zst) file names.
 * Does not parse file bodies.
 */
export function listColdPresentNativeSessionIds(roots: string[]): Set<string> {
  const present = new Set<string>();
  for (const root of roots) {
    const resolved = resolve(root);
    if (!existsSync(resolved)) continue;
    walkColdFiles(resolved, (filePath) => {
      const id = nativeSessionIdFromColdPath(filePath);
      if (id) present.add(id);
    });
  }
  return present;
}

export function nativeSessionIdFromColdPath(filePath: string): string | null {
  const match = filePath.match(CODEX_COLD_FILE_RE);
  return match?.[1]?.toLowerCase() ?? null;
}

export class ColdRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColdRootError";
  }
}

function walkColdFiles(dir: string, onFile: (filePath: string) => void): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkColdFiles(full, onFile);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".jsonl") || entry.name.endsWith(".jsonl.zst")) {
      onFile(full);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
