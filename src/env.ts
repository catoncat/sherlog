import { existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Default data dir resolution:
//   1. $SHLOG_DATA_DIR (explicit override) — wins
//   2. $CXS_DATA_DIR                       — legacy override, still honored
//   3. $XDG_STATE_HOME/shlog              — XDG state convention
//   4. ~/.local/state/shlog               — XDG fallback
//
// Why state and not cache: Sherlog's index is rebuildable but rebuilding takes
// minutes on real corpora, so it's "warm state", not throwaway cache.
// XDG_STATE_HOME is exactly the bucket for "data that should persist
// between application runs but is not important enough to be put in
// XDG_DATA_HOME".
//
// macOS gets the same Unix-style path on purpose — dev CLIs blend better
// with the rest of the user's tooling there than under
// ~/Library/Application Support/.
//
// Windows is unsupported (see package.json `os` field). If the code
// somehow runs there it'll still produce a path under homedir().
export const PROGRAM_NAME = "shlog";
export const LEGACY_PROGRAM_NAME = "cxs";
const LEGACY_CACHE_DIR = join(homedir(), ".cache", LEGACY_PROGRAM_NAME);

function defaultDataDir(): string {
  const xdgState = process.env.XDG_STATE_HOME;
  if (xdgState) return resolve(xdgState, PROGRAM_NAME);
  return join(homedir(), ".local", "state", PROGRAM_NAME);
}

function legacyStateDir(): string {
  const xdgState = process.env.XDG_STATE_HOME;
  if (xdgState) return resolve(xdgState, LEGACY_PROGRAM_NAME);
  return join(homedir(), ".local", "state", LEGACY_PROGRAM_NAME);
}

const DATA_DIR = process.env.SHLOG_DATA_DIR
  ? resolve(process.env.SHLOG_DATA_DIR)
  : process.env.CXS_DATA_DIR
    ? resolve(process.env.CXS_DATA_DIR)
  : defaultDataDir();

export const DEFAULT_DB_PATH = resolve(DATA_DIR, "index.sqlite");
export const DEFAULT_CODEX_DIR = resolve(homedir(), ".codex", "sessions");
export const INDEX_VERSION = "shlog-v7-source-identity";
const INDEX_VERSION_COMPAT = new Set([INDEX_VERSION, "cxs-v7-source-identity"]);

export function isCurrentIndexVersion(value: string | null | undefined): boolean {
  return typeof value === "string" && INDEX_VERSION_COMPAT.has(value);
}

// 效率回述开关:控制文本输出 header 里的「检索 N 条 · Xms / 读取 K 条」这类
// 注解。默认开(让 shlog 的快/省可感知);设 SHLOG_STATS=0/off/false/no 关闭。
// 只影响人类可读的文本注解;--json 的 elapsedMs / scannedMessageCount 始终保留。
export function statsReadoutEnabled(): boolean {
  const value = (process.env.SHLOG_STATS ?? process.env.CXS_STATS ?? "").trim().toLowerCase();
  return value !== "0" && value !== "off" && value !== "false" && value !== "no";
}

export function ensureDataDir(): void {
  migrateLegacyDataDirIfNeeded();
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function resolveCodexDir(override?: string): string {
  return override ? resolve(override) : DEFAULT_CODEX_DIR;
}

function legacyDataDirs(): string[] {
  return [legacyStateDir(), LEGACY_CACHE_DIR].filter((value, index, values) => values.indexOf(value) === index);
}

// Convenience wrapper called once from cli.ts entry — keeps migration out of
// env.ts's top-level so vitest importing env.ts doesn't touch user home as a
// side effect. Safe to call multiple times (idempotent).
export function migrateLegacyDataDirIfNeeded(): boolean {
  for (const legacyDir of legacyDataDirs()) {
    if (migrateLegacyDataDir(legacyDir, DATA_DIR)) return true;
  }
  return false;
}

// One-shot migration from old cxs defaults to whatever DATA_DIR resolves to
// now. No-op when:
//   - dest already has data (we don't clobber)
//   - legacy doesn't exist (clean install)
//   - user opted into a custom dir via SHLOG_DATA_DIR / CXS_DATA_DIR pointing
//     at the legacy location
//     cache (they're consciously using cache; respect that)
//
// Failure (e.g. cross-device rename, perm error) is swallowed — the worst
// case is the user re-running `shlog sync`, which is cheap and idempotent.
// Exported for unit tests.
export function migrateLegacyDataDir(legacyDir: string, destDir: string): boolean {
  if (legacyDir === destDir) return false;
  if (!existsSync(legacyDir)) return false;
  if (existsSync(destDir)) return false;

  try {
    mkdirSync(dirname(destDir), { recursive: true });
    renameSync(legacyDir, destDir);
    return true;
  } catch {
    return false;
  }
}
