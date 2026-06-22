import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectStatus } from "./status";
import { openWriteDb, replaceCoverage } from "./db";
import { INDEX_VERSION } from "./env";
import { collectSourceSnapshot } from "./source-inventory";
import { getSessionSourceAdapter } from "./sources";
import type { Selector } from "./types";

describe("collectStatus", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `cxs-status-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
    mkdirSync(tempDir, { recursive: true });
    dbPath = join(tempDir, "test.db");

    // Create a dummy jsonl file so source inventory finds something.
    // Must match the format expected by readCwdMetadata.
    const filePath = join(tempDir, "rollout-2023-10-01T12-00-00.jsonl");
    writeFileSync(
      filePath,
      `{"type":"session_meta","payload":{"cwd":"/test/project"}}` + "\n"
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns index.exists: false and empty coverage when DB does not exist", async () => {
    const status = await collectStatus({ rootDir: tempDir, dbPath: join(tempDir, "nonexistent.db") });
    expect(status.index.exists).toBe(false);
    expect(status.coverage).toEqual([]);
    expect(status.sourceInventory.totalFiles).toBe(1);
    expect(status.sourceInventory.cwdGroups[0].cwd).toBe("/test/project");
  });

  it("returns index.exists: true and empty coverage when DB exists but has no coverage", async () => {
    // Create an empty db
    const db = openWriteDb(dbPath);
    db.close();

    const status = await collectStatus({ rootDir: tempDir, dbPath });
    expect(status.index.exists).toBe(true);
    expect(status.coverage).toEqual([]);
  });

  it("returns freshness: 'fresh' when coverage exactly matches source files", async () => {
    const db = openWriteDb(dbPath);
    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };
    const snapshot = await collectSourceSnapshot(selector);

    replaceCoverage(db, selector, snapshot.fingerprint, snapshot.fileCount, 1, INDEX_VERSION);
    db.close();

    const status = await collectStatus({ rootDir: tempDir, dbPath });
    expect(status.coverage.length).toBe(1);
    expect(status.coverage[0].freshness).toBe("fresh");
  });

  it("returns freshness: 'stale' when coverage source fingerprint mismatches", async () => {
    const db = openWriteDb(dbPath);
    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };

    // Use incorrect fingerprint to force stale
    replaceCoverage(db, selector, "bad_fingerprint", 1, 1, INDEX_VERSION);
    db.close();

    const status = await collectStatus({ rootDir: tempDir, dbPath });
    expect(status.coverage.length).toBe(1);
    expect(status.coverage[0].freshness).toBe("stale");
  });

  it("reuses one source file scan for multiple coverage freshness checks on the same root", async () => {
    const db = openWriteDb(dbPath);
    const allSelector: Selector = { kind: "all", root: tempDir };
    const cwdSelector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };
    const dateSelector: Selector = {
      kind: "date_range",
      root: tempDir,
      fromDate: "2023-10-01",
      toDate: "2023-10-01",
    };

    for (const selector of [allSelector, cwdSelector, dateSelector]) {
      const snapshot = await collectSourceSnapshot(selector);
      replaceCoverage(db, selector, snapshot.fingerprint, snapshot.fileCount, 1, INDEX_VERSION);
    }
    db.close();

    const adapter = getSessionSourceAdapter("codex") as ReturnType<typeof getSessionSourceAdapter> & {
      collectFiles?: (root: string) => Promise<unknown[]>;
    };
    expect(adapter.collectFiles).toBeDefined();
    const collectFilesSpy = vi.spyOn(adapter as ReturnType<typeof getSessionSourceAdapter> & {
      collectFiles: (root: string) => Promise<unknown[]>;
    }, "collectFiles");

    const status = await collectStatus({ rootDir: tempDir, dbPath, selector: cwdSelector });

    expect(status.coverage).toHaveLength(3);
    expect(status.coverage.map((entry) => entry.freshness)).toEqual(["fresh", "fresh", "fresh"]);
    expect(status.requestedCoverage?.freshness).toBe("fresh");
    expect(collectFilesSpy).toHaveBeenCalledTimes(1);
  });

  it("calculates requestedCoverage correctly when requested selector has fresh coverage", async () => {
    const db = openWriteDb(dbPath);
    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };
    const snapshot = await collectSourceSnapshot(selector);

    replaceCoverage(db, selector, snapshot.fingerprint, snapshot.fileCount, 1, INDEX_VERSION);
    db.close();

    const status = await collectStatus({ rootDir: tempDir, dbPath, selector });
    expect(status.requestedCoverage).toBeDefined();
    expect(status.requestedCoverage?.freshness).toBe("fresh");
    expect(status.requestedCoverage?.complete).toBe(true);
    expect(status.requestedCoverage?.staleReason).toBe("none");
    expect(status.requestedCoverage?.recommendedAction).toBe("query");
  });

  it("lets requestedCoverage query when stale coverage only reflects changed existing source content", async () => {
    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };
    const initialSnapshot = await collectSourceSnapshot(selector);

    const db = openWriteDb(dbPath);
    replaceCoverage(db, selector, initialSnapshot.fingerprint, initialSnapshot.fileCount, 1, INDEX_VERSION);
    db.close();

    writeFileSync(
      join(tempDir, "rollout-2023-10-01T12-00-00.jsonl"),
      [
        `{"type":"session_meta","payload":{"cwd":"/test/project"}}`,
        `{"type":"event_msg","payload":{"type":"user_message","message":"active tail"}}`,
      ].join("\n"),
    );

    const status = await collectStatus({ rootDir: tempDir, dbPath, selector });
    expect(status.requestedCoverage).toBeDefined();
    expect(status.requestedCoverage?.freshness).toBe("stale");
    expect(status.requestedCoverage?.complete).toBe(false);
    expect(status.requestedCoverage?.staleReason).toBe("source_content_changed");
    expect(status.requestedCoverage?.recommendedAction).toBe("query");
  });

  it("calculates requestedCoverage correctly when requested selector has stale source set coverage", async () => {
    const db = openWriteDb(dbPath);
    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };
    const initialSnapshot = await collectSourceSnapshot(selector);

    replaceCoverage(db, selector, initialSnapshot.fingerprint, initialSnapshot.fileCount, 1, INDEX_VERSION);
    db.close();

    writeFileSync(
      join(tempDir, "rollout-2023-10-01T13-00-00.jsonl"),
      `{"type":"session_meta","payload":{"cwd":"/test/project"}}` + "\n",
    );

    const status = await collectStatus({ rootDir: tempDir, dbPath, selector });
    expect(status.requestedCoverage).toBeDefined();
    expect(status.requestedCoverage?.freshness).toBe("stale");
    expect(status.requestedCoverage?.complete).toBe(false);
    expect(status.requestedCoverage?.staleReason).toBe("source_set_changed");
    expect(status.requestedCoverage?.recommendedAction).toBe("sync");
  });

  it("calculates requestedCoverage correctly when requested selector has missing coverage", async () => {
    const db = openWriteDb(dbPath);
    db.close();

    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };
    const status = await collectStatus({ rootDir: tempDir, dbPath, selector });

    expect(status.requestedCoverage).toBeDefined();
    expect(status.requestedCoverage?.freshness).toBe("missing");
    expect(status.requestedCoverage?.complete).toBe(false);
    expect(status.requestedCoverage?.staleReason).toBe("missing");
    expect(status.requestedCoverage?.recommendedAction).toBe("sync");
  });

});
