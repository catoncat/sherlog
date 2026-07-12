import { afterEach, describe, expect, test, vi } from "vitest";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { openReadDb, openWriteDb } from "./db";
import { SyncError, syncSessions } from "./indexer";
import { findSessions, getMessagePage } from "./query";
import { codexSourceAdapter } from "./sources/codex";
import { collectStatus } from "./status";
import { syncLockPath } from "./sync-lock";

const tempDirs: string[] = [];
const unreadableFiles: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const filePath of unreadableFiles.splice(0)) {
    try {
      chmodSync(filePath, 0o644);
    } catch {
      // ignore cleanup failures for files that already disappeared
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("syncSessions", () => {
  test("commits a stable Codex snapshot when an active JSONL appends during sync", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-active-append-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "07", "12");
    mkdirSync(day, { recursive: true });

    const activePath = join(day, "rollout-2026-07-12T10-00-00-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl");
    const stablePath = join(day, "rollout-2026-07-12T09-00-00-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl");
    writeFileSync(
      activePath,
      [
        line("session_meta", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/active-append" }),
        line("event_msg", { type: "user_message", message: "active prefix" }),
      ].join("\n"),
    );
    writeFileSync(
      stablePath,
      [
        line("session_meta", { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cwd: "/tmp/active-append" }),
        line("event_msg", { type: "user_message", message: "stable source" }),
      ].join("\n"),
    );

    const originalParseFile = codexSourceAdapter.parseFile.bind(codexSourceAdapter);
    let appended = false;
    vi.spyOn(codexSourceAdapter, "parseFile").mockImplementation(async (file) => {
      const parsed = await originalParseFile(file);
      if (file.filePath === activePath && !appended) {
        appended = true;
        appendFileSync(activePath, `\n${line("event_msg", { type: "agent_message", message: "appended tail" })}`);
      }
      return parsed;
    });

    const dbPath = join(base, "index.sqlite");
    const selector = { kind: "all" as const, root };
    const first = await syncSessions({ dbPath, selector });

    expect(first.errors).toBe(0);
    expect(first.added).toBe(2);
    expect(first.coverage.written).toBe(true);
    expect(first.coverage.staleReason).toBe("source_content_changed");
    expect(first.coverage.recommendedAction).toBe("query");
    const stableFind = findSessions(dbPath, "stable source", 5, selector);
    expect(stableFind.results).toHaveLength(1);
    expect(stableFind.nextAction).toBeUndefined();
    expect(findSessions(dbPath, "appended tail", 5, selector).results).toHaveLength(0);
    expect(getMessagePage(dbPath, "codex:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 0, 10).messages)
      .toEqual(expect.arrayContaining([expect.objectContaining({ contentText: "stable source" })]));

    const status = await collectStatus({ dbPath, selector });
    expect(status.requestedCoverage).toMatchObject({
      freshness: "stale",
      staleReason: "source_content_changed",
      recommendedAction: "query",
      complete: false,
    });

    vi.restoreAllMocks();
    const second = await syncSessions({ dbPath, selector });

    expect(second.updated).toBe(1);
    expect(findSessions(dbPath, "appended tail", 5, selector).results).toHaveLength(1);
  });

  test("updates another stable source when an already-indexed Codex file starts appending mid-sync", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-existing-active-append-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "07", "12");
    mkdirSync(day, { recursive: true });
    const activePath = join(day, "rollout-2026-07-12T10-00-00-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl");
    const stablePath = join(day, "rollout-2026-07-12T09-00-00-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl");
    writeFileSync(activePath, [
      line("session_meta", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/existing-active" }),
      line("event_msg", { type: "user_message", message: "existing active prefix" }),
    ].join("\n"));
    writeFileSync(stablePath, [
      line("session_meta", { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cwd: "/tmp/existing-active" }),
      line("event_msg", { type: "user_message", message: "stable version one" }),
    ].join("\n"));

    const dbPath = join(base, "index.sqlite");
    const selector = { kind: "all" as const, root };
    await syncSessions({ dbPath, selector });
    appendFileSync(stablePath, `\n${line("event_msg", { type: "agent_message", message: "stable version two" })}`);

    const originalParseFile = codexSourceAdapter.parseFile.bind(codexSourceAdapter);
    let appended = false;
    vi.spyOn(codexSourceAdapter, "parseFile").mockImplementation(async (file) => {
      const parsed = await originalParseFile(file);
      if (file.filePath === stablePath && !appended) {
        appended = true;
        appendFileSync(activePath, `\n${line("event_msg", { type: "agent_message", message: "new active tail" })}`);
      }
      return parsed;
    });

    const summary = await syncSessions({ dbPath, selector });

    expect(summary.updated).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.coverage).toMatchObject({
      written: true,
      staleReason: "source_content_changed",
      recommendedAction: "query",
    });
    expect(findSessions(dbPath, "stable version two", 5, selector).results).toHaveLength(1);
    expect(findSessions(dbPath, "new active tail", 5, selector).results).toHaveLength(0);
  });

  test("defers an unindexed Codex file that changed before its bounded read while committing stable sources", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-pre-read-change-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "07", "12");
    mkdirSync(day, { recursive: true });
    const activePath = join(day, "rollout-2026-07-12T10-00-00-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl");
    const stablePath = join(day, "rollout-2026-07-12T09-00-00-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl");
    writeFileSync(activePath, [
      line("session_meta", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/pre-read-change" }),
      line("event_msg", { type: "user_message", message: "unproven original prefix" }),
    ].join("\n"));
    writeFileSync(stablePath, [
      line("session_meta", { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cwd: "/tmp/pre-read-change" }),
      line("event_msg", { type: "user_message", message: "stable source survives" }),
    ].join("\n"));

    const originalParseFile = codexSourceAdapter.parseFile.bind(codexSourceAdapter);
    let changed = false;
    vi.spyOn(codexSourceAdapter, "parseFile").mockImplementation(async (file) => {
      if (file.filePath === activePath && !changed) {
        changed = true;
        writeFileSync(activePath, [
          line("session_meta", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/pre-read-change" }),
          line("event_msg", { type: "user_message", message: "rewritten before read" }),
          line("event_msg", { type: "agent_message", message: "larger unproven tail" }),
        ].join("\n"));
      }
      return originalParseFile(file);
    });

    const dbPath = join(base, "index.sqlite");
    const selector = { kind: "all" as const, root };
    const first = await syncSessions({ dbPath, selector });

    expect(first.errors).toBe(0);
    expect(first.added).toBe(1);
    expect(first.coverage).toMatchObject({
      written: false,
      reason: "active_source_deferred",
      recommendedAction: "sync",
    });
    expect(findSessions(dbPath, "stable source survives", 5, selector).results).toHaveLength(1);
    expect(findSessions(dbPath, "rewritten before read", 5, selector).results).toHaveLength(0);

    vi.restoreAllMocks();
    const second = await syncSessions({ dbPath, selector });
    expect(second.added).toBe(1);
    expect(second.coverage.written).toBe(true);
    expect(findSessions(dbPath, "rewritten before read", 5, selector).results).toHaveLength(1);
  });

  test.each([
    {
      name: "truncates the file",
      mutate(filePath: string) {
        writeFileSync(filePath, line("session_meta", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/destructive-change" }));
      },
    },
    {
      name: "rewrites the indexed prefix before appending",
      mutate(filePath: string) {
        writeFileSync(
          filePath,
          [
            line("session_meta", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/destructive-change" }),
            line("event_msg", { type: "user_message", message: "rewritten prefix" }),
            line("event_msg", { type: "agent_message", message: "larger replacement tail" }),
          ].join("\n"),
        );
      },
    },
  ])("strict sync still fails when a Codex source $name during sync", async ({ mutate }) => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-destructive-change-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "07", "12");
    mkdirSync(day, { recursive: true });
    const activePath = join(day, "rollout-2026-07-12T10-00-00-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl");
    writeFileSync(
      activePath,
      [
        line("session_meta", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/destructive-change" }),
        line("event_msg", { type: "user_message", message: "original prefix" }),
      ].join("\n"),
    );

    const originalParseFile = codexSourceAdapter.parseFile.bind(codexSourceAdapter);
    let changed = false;
    vi.spyOn(codexSourceAdapter, "parseFile").mockImplementation(async (file) => {
      const parsed = await originalParseFile(file);
      if (file.filePath === activePath && !changed) {
        changed = true;
        mutate(activePath);
      }
      return parsed;
    });

    const dbPath = join(base, "index.sqlite");
    const failure = await syncSessions({ dbPath, selector: { kind: "all", root } }).catch((error) => error);

    expect(failure).toBeInstanceOf(SyncError);
    expect(failure.summary.errorDetails).toEqual([
      { filePath: "(selector)", message: "source changed during strict sync" },
    ]);
    const db = openReadDb(dbPath);
    const counts = db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number };
    db.close();
    expect(counts.count).toBe(0);
  });

  test("fails loudly with per-file diagnostics and leaves no partial index by default", async () => {
    const { base, dbPath, sessionsRoot, badFilePath } = createFixture();

    const failure = await syncSessions({ dbPath, rootDir: sessionsRoot }).catch((error) => error);
    expect(failure).toBeInstanceOf(SyncError);
    expect(failure.summary.errors).toBe(1);
    expect(failure.summary.errorDetails).toHaveLength(1);
    expect(failure.summary.errorDetails[0]?.filePath).toBe(badFilePath);
    expect(failure.summary.errorDetails[0]?.message.length).toBeGreaterThan(0);

    const db = openReadDb(dbPath);
    const row = db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number };
    db.close();
    expect(row.count).toBe(0);

    chmodSync(badFilePath, 0o644);
    unreadableFiles.splice(unreadableFiles.indexOf(badFilePath), 1);
    rmSync(base, { recursive: true, force: true });
  });

  test("can opt into best-effort sync and still returns failure diagnostics", async () => {
    const { dbPath, sessionsRoot, badFilePath } = createFixture();

    const summary = await syncSessions({
      dbPath,
      selector: { kind: "all", root: sessionsRoot },
      bestEffort: true,
    });
    expect(summary.added).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.errorDetails).toHaveLength(1);
    expect(summary.errorDetails[0]?.filePath).toBe(badFilePath);
    expect(summary.coverage.written).toBe(false);

    const db = openReadDb(dbPath);
    const row = db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number };
    const coverage = db.prepare("SELECT COUNT(*) AS count FROM coverage").get() as { count: number };
    db.close();
    expect(row.count).toBe(1);
    expect(coverage.count).toBe(0);
  });

  test("strict sync writes complete coverage for the selector", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-coverage-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const sessionsRoot = join(root, "2026", "04", "22");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-22T12-00-00-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl"),
      [
        line("session_meta", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/covered" }),
        line("event_msg", { type: "user_message", message: "covered session" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const summary = await syncSessions({
      dbPath,
      selector: { kind: "cwd_date_range", root, cwd: "/tmp/covered", fromDate: "2026-04-22", toDate: "2026-04-22" },
    });

    expect(summary.added).toBe(1);
    expect(summary.coverage.written).toBe(true);
    expect(summary.coverage.selector).toMatchObject({
      kind: "cwd_date_range",
      cwd: "/tmp/covered",
      fromDate: "2026-04-22",
      toDate: "2026-04-22",
    });

    const db = openReadDb(dbPath);
    const coverage = db.prepare("SELECT selector_kind AS kind, cwd, from_date AS fromDate, to_date AS toDate, source_file_count AS sourceFileCount FROM coverage").get() as {
      kind: string;
      cwd: string;
      fromDate: string;
      toDate: string;
      sourceFileCount: number;
    };
    db.close();

    expect(coverage).toEqual({
      kind: "cwd_date_range",
      cwd: "/tmp/covered",
      fromDate: "2026-04-22",
      toDate: "2026-04-22",
      sourceFileCount: 1,
    });
  });

  test("strict sync retains indexed rows whose source files disappeared by default", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-reconcile-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "22");
    mkdirSync(day, { recursive: true });

    const deletedPath = join(day, "rollout-2026-04-22T10-00-00-11111111-1111-4111-8111-111111111111.jsonl");
    const keptPath = join(day, "rollout-2026-04-22T11-00-00-22222222-2222-4222-8222-222222222222.jsonl");
    writeFileSync(
      deletedPath,
      [
        line("session_meta", { id: "11111111-1111-4111-8111-111111111111", cwd: "/tmp/reconcile" }),
        line("event_msg", { type: "user_message", message: "needle deleted" }),
      ].join("\n"),
    );
    writeFileSync(
      keptPath,
      [
        line("session_meta", { id: "22222222-2222-4222-8222-222222222222", cwd: "/tmp/reconcile" }),
        line("event_msg", { type: "user_message", message: "needle kept" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const selector = { kind: "all" as const, root };
    await syncSessions({ dbPath, selector });

    rmSync(deletedPath);
    const summary = await syncSessions({ dbPath, selector });

    expect(summary.removed).toBe(0);
    expect(summary.coverage.sourceFileCount).toBe(1);
    expect(summary.coverage.indexedSessionCount).toBe(2);

    const found = findSessions(dbPath, "needle", 10, selector);
    expect(found.results.map((result) => result.sessionUuid).sort()).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ].sort());
  });

  test("sync --prune reconciles deleted source files before writing coverage", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-prune-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "22");
    mkdirSync(day, { recursive: true });

    const deletedPath = join(day, "rollout-2026-04-22T10-00-00-11111111-1111-4111-8111-111111111111.jsonl");
    const keptPath = join(day, "rollout-2026-04-22T11-00-00-22222222-2222-4222-8222-222222222222.jsonl");
    writeFileSync(
      deletedPath,
      [
        line("session_meta", { id: "11111111-1111-4111-8111-111111111111", cwd: "/tmp/prune" }),
        line("event_msg", { type: "user_message", message: "needle deleted" }),
      ].join("\n"),
    );
    writeFileSync(
      keptPath,
      [
        line("session_meta", { id: "22222222-2222-4222-8222-222222222222", cwd: "/tmp/prune" }),
        line("event_msg", { type: "user_message", message: "needle kept" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const selector = { kind: "all" as const, root };
    await syncSessions({ dbPath, selector });

    rmSync(deletedPath);
    const summary = await syncSessions({ dbPath, selector, prune: true });

    expect(summary.removed).toBe(1);
    expect(summary.coverage.sourceFileCount).toBe(1);
    expect(summary.coverage.indexedSessionCount).toBe(1);

    const found = findSessions(dbPath, "needle", 10, selector);
    expect(found.results.map((result) => result.sessionUuid)).toEqual([
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  test("strict sync refuses an unavailable source root instead of deleting indexed rows", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-missing-root-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "22");
    mkdirSync(day, { recursive: true });

    writeFileSync(
      join(day, "rollout-2026-04-22T12-00-00-44444444-4444-4444-8444-444444444444.jsonl"),
      [
        line("session_meta", { id: "44444444-4444-4444-8444-444444444444", cwd: "/tmp/missing-root" }),
        line("event_msg", { type: "user_message", message: "keep this indexed row" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const selector = { kind: "all" as const, root };
    await syncSessions({ dbPath, selector });

    rmSync(root, { recursive: true, force: true });
    const failure = await syncSessions({ dbPath, selector }).catch((error) => error);

    expect(failure).toBeInstanceOf(SyncError);
    expect(failure.summary.errors).toBe(1);
    expect(failure.summary.coverage.written).toBe(false);
    expect(failure.summary.coverage.reason).toBe("source_unavailable");
    expect(failure.summary.errorDetails[0]?.filePath).toBe(root);

    const db = openReadDb(dbPath);
    const sessions = db.prepare("SELECT session_uuid AS sessionUuid FROM sessions").all() as Array<{ sessionUuid: string }>;
    const coverage = db.prepare("SELECT source_file_count AS sourceFileCount FROM coverage").get() as { sourceFileCount: number };
    db.close();

    expect(sessions).toEqual([{ sessionUuid: "44444444-4444-4444-8444-444444444444" }]);
    expect(coverage.sourceFileCount).toBe(1);
  });

  test("strict sync does not create a new index database when the source root is unavailable", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-missing-root-new-db-"));
    tempDirs.push(base);
    const root = join(base, "missing-sessions");
    const dbPath = join(base, "index.sqlite");

    const failure = await syncSessions({
      dbPath,
      selector: { kind: "all", root },
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(SyncError);
    expect(failure.summary.coverage.reason).toBe("source_unavailable");
    expect(existsSync(dbPath)).toBe(false);
  });

  test("cwd selector refuses unreadable cwd metadata instead of writing false coverage", async () => {
    const { dbPath, sessionsRoot, badFilePath } = createFixture();

    const failure = await syncSessions({
      dbPath,
      selector: { kind: "cwd", root: sessionsRoot, cwd: "/tmp/bad" },
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(SyncError);
    expect(failure.summary.errors).toBe(1);
    expect(failure.summary.coverage.written).toBe(false);
    expect(failure.summary.coverage.reason).toBe("source_unavailable");
    expect(failure.summary.errorDetails[0]?.filePath).toBe(badFilePath);

    expect(existsSync(dbPath)).toBe(false);
  });

  test("strict sync rebuilds legacy rows missing path_date before date-range coverage", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-legacy-path-date-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "22");
    mkdirSync(day, { recursive: true });

    writeFileSync(
      join(day, "rollout-2026-04-22T12-00-00-33333333-3333-4333-8333-333333333333.jsonl"),
      [
        line("session_meta", { id: "33333333-3333-4333-8333-333333333333", cwd: "/tmp/legacy-path-date" }),
        line("event_msg", { type: "user_message", message: "dated needle" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const allSelector = { kind: "all" as const, root };
    await syncSessions({ dbPath, selector: allSelector });

    const writeDb = openWriteDb(dbPath);
    writeDb
      .prepare("UPDATE sessions SET path_date = '', index_version = ? WHERE session_uuid = ?")
      .run("cxs-v5-session-field-weights", "33333333-3333-4333-8333-333333333333");
    writeDb.close();

    const dateSelector = { kind: "date_range" as const, root, fromDate: "2026-04-22", toDate: "2026-04-22" };
    const summary = await syncSessions({ dbPath, selector: dateSelector });

    expect(summary.updated).toBe(1);
    expect(summary.coverage.indexedSessionCount).toBe(1);

    const found = findSessions(dbPath, "dated needle", 5, dateSelector);
    expect(found.coverage.complete).toBe(true);
    expect(found.results.map((result) => result.sessionUuid)).toEqual([
      "33333333-3333-4333-8333-333333333333",
    ]);
  });

  test("waits for an existing sync writer lock before opening the database", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-lock-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "22");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-22T12-00-00-dddddddd-dddd-4ddd-8ddd-dddddddddddd.jsonl"),
      [
        line("session_meta", { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", cwd: "/tmp/locked" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "user_message", message: "writer lock test" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const blocker = await holdSyncLock(syncLockPath(dbPath), 350);
    const startedAt = Date.now();
    const summary = await syncSessions({ dbPath, selector: { kind: "all", root: join(base, "sessions") } });
    const elapsedMs = Date.now() - startedAt;
    await blocker.done;

    expect(summary.added).toBe(1);
    expect(elapsedMs).toBeGreaterThanOrEqual(150);
  });

  test("removes stale sync writer locks from dead pids before proceeding", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-indexer-stale-lock-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "22");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-22T14-00-00-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jsonl"),
      [
        line("session_meta", { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", cwd: "/tmp/stale-lock" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "user_message", message: "stale writer lock test" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const lockPath = syncLockPath(dbPath);
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 999_999, createdAt: new Date("2026-04-22T00:00:00.000Z").toISOString() }),
    );

    const summary = await syncSessions({ dbPath, selector: { kind: "all", root: join(base, "sessions") } });

    expect(summary.added).toBe(1);
    expect(existsSync(lockPath)).toBe(false);
  });
});

function createFixture(): {
  base: string;
  dbPath: string;
  sessionsRoot: string;
  badFilePath: string;
} {
  const base = mkdtempSync(join(tmpdir(), "cxs-indexer-"));
  tempDirs.push(base);
  const sessionsRoot = join(base, "sessions", "2026", "04", "22");
  mkdirSync(sessionsRoot, { recursive: true });

  writeFileSync(
    join(sessionsRoot, "rollout-2026-04-22T12-00-00-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl"),
    [
      line("session_meta", { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cwd: "/tmp/good" }),
      line("turn_context", { model: "gpt-5.4" }),
      line("event_msg", { type: "user_message", message: "good session" }),
    ].join("\n"),
  );

  const badFilePath = join(
    sessionsRoot,
    "rollout-2026-04-22T13-00-00-cccccccc-cccc-4ccc-8ccc-cccccccccccc.jsonl",
  );
  writeFileSync(
    badFilePath,
    [
      line("session_meta", { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", cwd: "/tmp/bad" }),
      line("turn_context", { model: "gpt-5.4" }),
      line("event_msg", { type: "user_message", message: "unreadable session" }),
    ].join("\n"),
  );
  chmodSync(badFilePath, 0o000);
  unreadableFiles.push(badFilePath);

  return {
    base,
    dbPath: join(base, "index.sqlite"),
    sessionsRoot: join(base, "sessions"),
    badFilePath,
  };
}

function line(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: new Date("2026-04-22T00:00:00.000Z").toISOString(),
    type,
    payload,
  });
}

function holdSyncLock(
  lockPath: string,
  holdMs: number,
): Promise<{ done: Promise<number | null> }> {
  return new Promise((resolve, reject) => {
    const script = `
      import { writeFileSync, unlinkSync } from "node:fs";
      const [lockPath, holdMs] = process.argv.slice(1);
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
        { flag: "wx" },
      );
      console.log("locked");
      setTimeout(() => {
        unlinkSync(lockPath);
      }, Number(holdMs));
    `;
    const child = spawn(
      process.execPath,
      ["--eval", script, lockPath, String(holdMs)],
      { cwd: import.meta.dirname, stdio: ["ignore", "pipe", "pipe"] },
    );

    let settled = false;
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!settled && code !== 0) {
        settled = true;
        reject(new Error(stderr || `lock holder exited with code ${code}`));
      }
    });
    child.stdout.on("data", (chunk) => {
      if (settled || !chunk.includes("locked")) return;
      settled = true;
      resolve({
        done: new Promise((doneResolve, doneReject) => {
          child.on("error", doneReject);
          child.on("close", (code) => {
            if (code === 0) {
              doneResolve(code);
              return;
            }
            doneReject(new Error(stderr || `lock holder exited with code ${code}`));
          });
        }),
      });
    });
  });
}
