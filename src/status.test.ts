import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectStatus } from "./status";
import { openWriteDb, replaceCoverage } from "./db";
import { INDEX_VERSION } from "./env";
import { collectSourceSnapshot } from "./source-inventory";
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
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns index.exists: false and empty coverage when DB does not exist", () => {
    const status = collectStatus({ rootDir: tempDir, dbPath: join(tempDir, "nonexistent.db") });
    expect(status.index.exists).toBe(false);
    expect(status.coverage).toEqual([]);
    expect(status.sourceInventory.totalFiles).toBe(1);
    expect(status.sourceInventory.cwdGroups[0].cwd).toBe("/test/project");
  });

  it("returns index.exists: true and empty coverage when DB exists but has no coverage", () => {
    // Create an empty db
    const db = openWriteDb(dbPath);
    db.close();

    const status = collectStatus({ rootDir: tempDir, dbPath });
    expect(status.index.exists).toBe(true);
    expect(status.coverage).toEqual([]);
  });

  it("returns freshness: 'fresh' when coverage exactly matches source files", () => {
    const db = openWriteDb(dbPath);
    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };
    const snapshot = collectSourceSnapshot(selector);

    replaceCoverage(db, selector, snapshot.fingerprint, snapshot.fileCount, 1, INDEX_VERSION);
    db.close();

    const status = collectStatus({ rootDir: tempDir, dbPath });
    expect(status.coverage.length).toBe(1);
    expect(status.coverage[0].freshness).toBe("fresh");
  });

  it("returns freshness: 'stale' when coverage source fingerprint mismatches", () => {
    const db = openWriteDb(dbPath);
    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };

    // Use incorrect fingerprint to force stale
    replaceCoverage(db, selector, "bad_fingerprint", 1, 1, INDEX_VERSION);
    db.close();

    const status = collectStatus({ rootDir: tempDir, dbPath });
    expect(status.coverage.length).toBe(1);
    expect(status.coverage[0].freshness).toBe("stale");
  });

  it("calculates requestedCoverage correctly when requested selector has fresh coverage", () => {
    const db = openWriteDb(dbPath);
    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };
    const snapshot = collectSourceSnapshot(selector);

    replaceCoverage(db, selector, snapshot.fingerprint, snapshot.fileCount, 1, INDEX_VERSION);
    db.close();

    const status = collectStatus({ rootDir: tempDir, dbPath, selector });
    expect(status.requestedCoverage).toBeDefined();
    expect(status.requestedCoverage?.freshness).toBe("fresh");
    expect(status.requestedCoverage?.complete).toBe(true);
    expect(status.requestedCoverage?.recommendedAction).toBe("query");
  });

  it("calculates requestedCoverage correctly when requested selector has stale coverage", () => {
    const db = openWriteDb(dbPath);
    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };

    // Stale coverage
    replaceCoverage(db, selector, "bad_fingerprint", 1, 1, INDEX_VERSION);
    db.close();

    const status = collectStatus({ rootDir: tempDir, dbPath, selector });
    expect(status.requestedCoverage).toBeDefined();
    expect(status.requestedCoverage?.freshness).toBe("stale");
    expect(status.requestedCoverage?.complete).toBe(false);
    expect(status.requestedCoverage?.recommendedAction).toBe("sync");
  });

  it("calculates requestedCoverage correctly when requested selector has missing coverage", () => {
    const db = openWriteDb(dbPath);
    db.close();

    const selector: Selector = { kind: "cwd", root: tempDir, cwd: "/test/project" };
    const status = collectStatus({ rootDir: tempDir, dbPath, selector });

    expect(status.requestedCoverage).toBeDefined();
    expect(status.requestedCoverage?.freshness).toBe("missing");
    expect(status.requestedCoverage?.complete).toBe(false);
    expect(status.requestedCoverage?.recommendedAction).toBe("sync");
  });

});
