import { mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK_SUFFIX = ".sync.lock";
const LOCK_WAIT_TIMEOUT_MS = 10_000;
const LOCK_POLL_INTERVAL_MS = 100;

interface SyncLockInfo {
  pid: number;
  createdAt: string;
}

export interface ParsedLockInfo extends SyncLockInfo {
  isLegacy?: boolean;
}

export class SyncLockTimeoutError extends Error {
  constructor(lockPath: string, info: SyncLockInfo | null) {
    const owner = info ? `pid ${info.pid} since ${info.createdAt}` : "unknown owner";
    super(`sync already running: ${owner} (${lockPath})`);
    this.name = "SyncLockTimeoutError";
  }
}

export function syncLockPath(dbPath: string): string {
  return `${dbPath}${LOCK_SUFFIX}`;
}

export async function withSyncLock<T>(dbPath: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireSyncLock(syncLockPath(dbPath));
  try {
    return await fn();
  } finally {
    release();
  }
}

async function acquireSyncLock(lockPath: string): Promise<() => void> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  const lockInfo: SyncLockInfo = {
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };

  while (true) {
    try {
      mkdirSync(lockPath);
      // We acquired the directory lock. Write info inside it.
      const infoFilename = getInfoFilename(lockInfo);
      try {
        writeFileSync(join(lockPath, infoFilename), JSON.stringify(lockInfo));
      } catch (e: any) {
        // If the directory was removed by another process between our mkdir and our write,
        // (because they saw it was empty and assumed it was an orphaned lock),
        // we'll get ENOENT. We should just retry.
        if (e.code === "ENOENT") continue;
        throw e;
      }
      return () => releaseSyncLock(lockPath, lockInfo);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }

    const existing = readLockInfo(lockPath);
    if (existing === "empty") {
      // Empty directory, possibly orphaned or in the middle of being acquired.
      // We can try to remove it.
      if (tryRemoveEmptyLockDir(lockPath)) continue;
    } else if (existing && existing !== "legacy" && !isProcessAlive(existing.pid)) {
      if (tryRemoveStaleLock(lockPath, existing)) continue;
    } else if (existing === "legacy") {
      // If legacy lock is stale, we can't easily check PID because we couldn't parse it.
      // We will just let it timeout or fail if it's completely unparseable.
    }

    if (Date.now() >= deadline) {
      throw new SyncLockTimeoutError(lockPath, existing && existing !== "empty" && existing !== "legacy" ? existing : null);
    }

    await sleep(LOCK_POLL_INTERVAL_MS);
  }
}

function releaseSyncLock(lockPath: string, lockInfo: SyncLockInfo): void {
  const existing = readLockInfo(lockPath);
  if (!existing || existing === "empty" || existing === "legacy") return;
  if (existing.pid !== lockInfo.pid || existing.createdAt !== lockInfo.createdAt) return;
  removeLockIfPresent(lockPath, lockInfo, existing.isLegacy);
}

// Atomic TOCTOU fix: we use a directory as the lock. Removing a stale lock involves
// unlinking the unique info file inside the directory, then calling `rmdirSync` on the directory.
// `rmdirSync` will only succeed if the directory is empty. If another process created a new lock
// between our read and our remove, they would have written their own unique info file into the
// directory, making it non-empty and causing our `rmdirSync` to fail safely (ENOTEMPTY),
// thus preventing us from accidentally removing their lock.
// Exported for unit tests.
export function tryRemoveStaleLock(lockPath: string, expected: ParsedLockInfo): boolean {
  if (expected.isLegacy) {
    const reChecked = readLockInfo(lockPath);
    if (!reChecked || reChecked === "empty") return true;
    if (
      typeof reChecked === "object" &&
      reChecked.pid === expected.pid &&
      reChecked.createdAt === expected.createdAt &&
      reChecked.isLegacy
    ) {
      try {
        unlinkSync(lockPath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  const infoFilename = getInfoFilename(expected);
  try {
    unlinkSync(join(lockPath, infoFilename));
  } catch (e: any) {
    if (e.code !== "ENOENT") return false;
  }

  try {
    rmdirSync(lockPath);
    return true;
  } catch (e: any) {
    return e.code === "ENOENT";
  }
}

function tryRemoveEmptyLockDir(lockPath: string): boolean {
  try {
    rmdirSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

export function readLockInfo(lockPath: string): ParsedLockInfo | "empty" | "legacy" | null {
  let stat;
  try {
    stat = statSync(lockPath);
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    return null;
  }

  if (!stat.isDirectory()) {
    try {
      const raw = readFileSync(lockPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SyncLockInfo>;
      if (typeof parsed.pid === "number" && typeof parsed.createdAt === "string") {
        return { pid: parsed.pid, createdAt: parsed.createdAt, isLegacy: true };
      }
      return "legacy";
    } catch {
      return "legacy";
    }
  }

  let files;
  try {
    files = readdirSync(lockPath);
  } catch {
    return null;
  }

  if (files.length === 0) return "empty";

  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const raw = readFileSync(join(lockPath, file), "utf8");
        const parsed = JSON.parse(raw) as Partial<SyncLockInfo>;
        if (typeof parsed.pid === "number" && typeof parsed.createdAt === "string") {
          return { pid: parsed.pid, createdAt: parsed.createdAt };
        }
      } catch {
        // Ignore read errors for individual files
      }
    }
  }

  return "empty";
}

function getInfoFilename(info: SyncLockInfo): string {
  return `${info.pid}-${new Date(info.createdAt).getTime()}.json`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeLockIfPresent(lockPath: string, info: SyncLockInfo, isLegacy?: boolean): void {
  if (isLegacy) {
    try {
      rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    return;
  }

  try {
    unlinkSync(join(lockPath, getInfoFilename(info)));
  } catch {
    // Ignore
  }

  try {
    rmdirSync(lockPath);
  } catch {
    // Ignore
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
