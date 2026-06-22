import { afterEach, describe, expect, test } from "vitest";
import { spawn as childSpawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openWriteDb } from "./db";
import { INDEX_VERSION } from "./env";
import { syncSessions } from "./indexer";

const tempDirs: string[] = [];
const unreadableFiles: string[] = [];

afterEach(() => {
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

describe("shlog cli", { timeout: 20_000 }, () => {
  test("help only shows status/sync/find/read-range/read-page/list/stats", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("sync");
    expect(result.stdout).toContain("find");
    expect(result.stdout).toContain("read-range");
    expect(result.stdout).toContain("read-page");
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("stats");
    expect(result.stdout).not.toContain("current");
    expect(result.stdout).not.toContain("window");
    expect(result.stdout).not.toContain("\n  session ");
  });

  test("status returns source inventory without an index", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-status-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "20");
    mkdirSync(sessionsRoot, { recursive: true });
    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-20T10-00-00-11111111-1111-4111-8111-111111111111.jsonl"),
      [
        line("session_meta", { id: "11111111-1111-4111-8111-111111111111", cwd: "/tmp/alpha" }),
        line("event_msg", { type: "user_message", message: "alpha private content must not be needed" }),
      ].join("\n"),
    );

    const result = await runCli([
      "status",
      "--root",
      join(base, "sessions"),
      "--db",
      join(base, "missing.sqlite"),
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      sourceInventory: {
        totalFiles: number;
        pathDateRange: { from: string | null; to: string | null };
        cwdGroups: Array<{ cwd: string; fileCount: number; pathDateRange: { from: string | null; to: string | null } }>;
      };
      index: { exists: boolean };
    };
    expect(payload.index.exists).toBe(false);
    expect(payload.sourceInventory.totalFiles).toBe(1);
    expect(payload.sourceInventory.pathDateRange).toEqual({ from: "2026-04-20", to: "2026-04-20" });
    expect(payload.sourceInventory.cwdGroups).toEqual([
      { cwd: "/tmp/alpha", fileCount: 1, pathDateRange: { from: "2026-04-20", to: "2026-04-20" } },
    ]);
  });

  test("status --selector reports requested coverage without writing index", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-status-selector-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const sessionsRoot = join(root, "2026", "04", "20");
    mkdirSync(sessionsRoot, { recursive: true });
    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-20T10-00-00-10101010-1010-4010-8010-101010101010.jsonl"),
      [
        line("session_meta", { id: "10101010-1010-4010-8010-101010101010", cwd: "/tmp/selector-alpha" }),
        line("event_msg", { type: "user_message", message: "selector alpha" }),
      ].join("\n"),
    );

    const selector = JSON.stringify({ kind: "cwd", root, cwd: "/tmp/selector-alpha" });
    const result = await runCli(["status", "--root", root, "--selector", selector, "--db", join(base, "missing.sqlite"), "--json"]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      index: { exists: boolean };
      requestedCoverage: { complete: boolean; freshness: string; recommendedAction: string; sourceFileCount: number };
    };
    expect(payload.index.exists).toBe(false);
    expect(payload.requestedCoverage.complete).toBe(false);
    expect(payload.requestedCoverage.freshness).toBe("missing");
    expect(payload.requestedCoverage.recommendedAction).toBe("sync");
    expect(payload.requestedCoverage.sourceFileCount).toBe(1);
  });

  test("status --cwd builds a cwd selector with --root", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-status-cwd-shortcut-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const sessionsRoot = join(root, "2026", "04", "20");
    mkdirSync(sessionsRoot, { recursive: true });
    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-20T10-00-00-10101010-2020-4010-8010-101010101010.jsonl"),
      [
        line("session_meta", { id: "10101010-2020-4010-8010-101010101010", cwd: "/tmp/status-cwd-shortcut" }),
        line("event_msg", { type: "user_message", message: "status cwd shortcut" }),
      ].join("\n"),
    );

    const result = await runCli([
      "status",
      "--root",
      root,
      "--cwd",
      "/tmp/status-cwd-shortcut",
      "--db",
      join(base, "missing.sqlite"),
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      requestedCoverage: { requested: { kind: string; root: string; cwd?: string }; sourceFileCount: number };
    };
    expect(payload.requestedCoverage.requested).toMatchObject({
      kind: "cwd",
      root,
      cwd: "/tmp/status-cwd-shortcut",
    });
    expect(payload.requestedCoverage.sourceFileCount).toBe(1);
  });

  test("status --source codex can read old Codex index counts without migrating", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-status-source-old-db-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    mkdirSync(root, { recursive: true });
    const dbPath = join(base, "legacy.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY,
        session_uuid TEXT NOT NULL,
        file_path TEXT NOT NULL,
        title TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        cwd TEXT NOT NULL,
        model TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        path_date TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        raw_file_mtime REAL NOT NULL,
        raw_file_size INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        index_version TEXT NOT NULL
      );
      INSERT INTO sessions (
        session_uuid, file_path, title, summary_text, cwd, model, started_at,
        ended_at, path_date, message_count, raw_file_mtime, raw_file_size,
        updated_at, index_version
      ) VALUES (
        '15151515-1515-4515-8515-151515151515',
        '/tmp/legacy.jsonl',
        '',
        '',
        '/tmp/legacy',
        '',
        '2026-04-20T10:00:00.000Z',
        '2026-04-20T10:01:00.000Z',
        '2026-04-20',
        2,
        0,
        0,
        '2026-04-20T10:02:00.000Z',
        'cxs-v6'
      );
      CREATE TABLE coverage (
        id INTEGER PRIMARY KEY,
        selector_json TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        source_file_count INTEGER NOT NULL,
        indexed_session_count INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        index_version TEXT NOT NULL
      );
    `);
    db.close();

    const result = await runCli(["status", "--source", "codex", "--root", root, "--db", dbPath, "--json"]);

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      index: { exists: boolean; sessionCount: number; messageCount: number };
      coverage: unknown[];
    };
    expect(payload.index.exists).toBe(true);
    expect(payload.index.sessionCount).toBe(1);
    expect(payload.index.messageCount).toBe(2);
    expect(payload.coverage).toEqual([]);
  });

  test("fixed commands accept explicit --source codex and omitted find still sees Codex rows", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-source-codex-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "20");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-2026-04-20T10-00-00-14141414-1414-4414-8414-141414141414.jsonl"),
      [
        line("session_meta", { id: "14141414-1414-4414-8414-141414141414", cwd: "/tmp/source-codex" }),
        line("event_msg", { type: "user_message", message: "source codex needle" }),
        line("event_msg", { type: "agent_message", message: "source codex reply" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const synced = await runCli(["sync", "--source", "codex", "--root", root, "--db", dbPath, "--json"]);
    expect(synced.exitCode).toBe(0);
    const syncPayload = JSON.parse(synced.stdout) as { coverage: { selector: { source: string; kind: string; root: string } } };
    expect(syncPayload.coverage.selector).toEqual({ source: "codex", kind: "all", root });

    const status = await runCli(["status", "--source", "codex", "--root", root, "--db", dbPath, "--json"]);
    expect(status.exitCode).toBe(0);
    const statusPayload = JSON.parse(status.stdout) as {
      context: { root: string };
      sourceInventory: { totalFiles: number };
      coverage: Array<{ selector: { source: string } }>;
    };
    expect(statusPayload.context.root).toBe(root);
    expect(statusPayload.sourceInventory.totalFiles).toBe(1);
    expect(statusPayload.coverage[0]?.selector.source).toBe("codex");

    const defaultFind = await runCli(["find", "source codex needle", "--db", dbPath, "--json"]);
    const explicitFind = await runCli(["find", "source codex needle", "--source", "codex", "--db", dbPath, "--json"]);
    expect(defaultFind.exitCode).toBe(0);
    expect(explicitFind.exitCode).toBe(0);
    const defaultFindPayload = JSON.parse(defaultFind.stdout) as { results: Array<{ sessionUuid: string }> };
    const explicitFindPayload = JSON.parse(explicitFind.stdout) as { results: Array<{ sessionUuid: string }> };
    expect(explicitFindPayload.results.map((result) => result.sessionUuid)).toEqual(
      defaultFindPayload.results.map((result) => result.sessionUuid),
    );
    expect(explicitFindPayload.results[0]?.sessionUuid).toBe("14141414-1414-4414-8414-141414141414");

    const listed = await runCli(["list", "--source", "codex", "--db", dbPath, "--json"]);
    expect(listed.exitCode).toBe(0);
    const listPayload = JSON.parse(listed.stdout) as { query: { sourceId?: string }; results: Array<{ sessionUuid: string }> };
    expect(listPayload.query.sourceId).toBe("codex");
    expect(listPayload.results[0]?.sessionUuid).toBe("14141414-1414-4414-8414-141414141414");

    const stats = await runCli(["stats", "--source", "codex", "--db", dbPath, "--json"]);
    expect(stats.exitCode).toBe(0);
    const statsPayload = JSON.parse(stats.stdout) as { sessionCount: number; messageCount: number };
    expect(statsPayload.sessionCount).toBe(1);
    expect(statsPayload.messageCount).toBe(2);

    const range = await runCli([
      "read-range",
      "14141414-1414-4414-8414-141414141414",
      "--source",
      "codex",
      "--seq",
      "0",
      "--before",
      "0",
      "--after",
      "0",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(range.exitCode).toBe(0);
    const rangePayload = JSON.parse(range.stdout) as { session: { sourceId: string; sessionUuid: string }; messages: Array<{ contentText: string }> };
    expect(rangePayload.session.sourceId).toBe("codex");
    expect(rangePayload.session.sessionUuid).toBe("14141414-1414-4414-8414-141414141414");
    expect(rangePayload.messages[0]?.contentText).toBe("source codex needle");

    const page = await runCli([
      "read-page",
      "14141414-1414-4414-8414-141414141414",
      "--source",
      "codex",
      "--limit",
      "1",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(page.exitCode).toBe(0);
    const pagePayload = JSON.parse(page.stdout) as { session: { sourceId: string }; totalCount: number };
    expect(pagePayload.session.sourceId).toBe("codex");
    expect(pagePayload.totalCount).toBe(2);
  });

  test("bare sync bootstraps the default Codex root for first install", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-sync-first-install-"));
    tempDirs.push(base);
    const home = join(base, "home");
    const root = join(home, ".codex", "sessions");
    const day = join(root, "2026", "06", "09");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-2026-06-09T10-00-00-12121212-1212-4212-8212-121212121212.jsonl"),
      [
        line("session_meta", { id: "12121212-1212-4212-8212-121212121212", cwd: "/tmp/first-install" }),
        line("event_msg", { type: "user_message", message: "first install needle" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const synced = await runCli(["sync", "--db", dbPath, "--json"], { env: { HOME: home } });
    expect(synced.exitCode).toBe(0);
    const syncPayload = JSON.parse(synced.stdout) as {
      added: number;
      coverage: { selector: { source: string; kind: string; root: string } };
    };
    expect(syncPayload.added).toBe(1);
    expect(syncPayload.coverage.selector).toEqual({ source: "codex", kind: "all", root });
    expect(existsSync(dbPath)).toBe(true);

    const textSync = await runCli(["sync", "--db", dbPath], { env: { HOME: home } });
    expect(textSync.exitCode).toBe(0);
    expect(textSync.stdout).toContain("selector:");
    expect(textSync.stdout).toContain('"kind":"all"');
    expect(textSync.stdout).toContain(root);

    const found = await runCli(["find", "first install needle", "--db", dbPath, "--json"], { env: { HOME: home } });
    expect(found.exitCode).toBe(0);
    const findPayload = JSON.parse(found.stdout) as { results: Array<{ sessionUuid: string }> };
    expect(findPayload.results[0]?.sessionUuid).toBe("12121212-1212-4212-8212-121212121212");
  });

  test("fixed commands reject unsupported --source values before other work", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-source-unsupported-"));
    tempDirs.push(base);
    const dbPath = join(base, "missing.sqlite");
    const commands = [
      ["sync", "--source", "other", "--root", join(base, "sessions"), "--db", dbPath, "--json"],
      ["find", "needle", "--source", "other", "--db", dbPath, "--json"],
      ["read-range", "14141414-1414-4414-8414-141414141414", "--source", "other", "--db", dbPath, "--json"],
      ["read-page", "14141414-1414-4414-8414-141414141414", "--source", "other", "--db", dbPath, "--json"],
      ["list", "--source", "other", "--db", dbPath, "--json"],
      ["stats", "--source", "other", "--db", dbPath, "--json"],
    ];

    for (const command of commands) {
      const result = await runCli(command);
      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout) as { error: { code: string; source: string; message: string } };
      expect(payload.error.code).toBe("unsupported_source");
      expect(payload.error.message).toContain("unsupported source");
      expect(result.stderr).toBe("");
    }
  });

  test("selector JSON source is rejected when it is unsupported", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-selector-source-unsupported-"));
    tempDirs.push(base);
    const selector = JSON.stringify({ source: "other", kind: "all", root: join(base, "sessions") });

    const result = await runCli(["sync", "--selector", selector, "--db", join(base, "index.sqlite"), "--json"]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as { error: { code: string; source: string; message: string } };
    expect(payload.error.code).toBe("unsupported_source");
    expect(payload.error.source).toBe("other");
    expect(payload.error.message).toContain("unsupported source");
  });

  test("fixed commands accept explicit --source claude-code", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-source-claude-code-"));
    tempDirs.push(base);
    const root = join(base, "projects");
    mkdirSync(root, { recursive: true });
    const projectDir = join(root, "synthetic-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "conversation.jsonl"),
      [
        claudeLine({
          type: "user",
          sessionId: "cli-claude-session",
          cwd: "/tmp/source-claude",
          timestamp: "2026-06-06T00:00:00.000Z",
          message: { content: "source claude needle" },
        }),
        claudeLine({
          type: "assistant",
          sessionId: "cli-claude-session",
          cwd: "/tmp/source-claude",
          timestamp: "2026-06-06T00:00:01.000Z",
          message: { content: "source claude reply" },
        }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const synced = await runCli(["sync", "--source", "claude-code", "--root", root, "--db", dbPath, "--json"]);
    expect(synced.exitCode).toBe(0);
    const syncPayload = JSON.parse(synced.stdout) as { coverage: { selector: { source: string; kind: string; root: string } } };
    expect(syncPayload.coverage.selector).toEqual({ source: "claude-code", kind: "all", root });

    const status = await runCli(["status", "--source", "claude-code", "--root", root, "--db", dbPath, "--json"]);
    expect(status.exitCode).toBe(0);
    const statusPayload = JSON.parse(status.stdout) as {
      context: { root: string };
      sourceInventory: { totalFiles: number };
      coverage: Array<{ selector: { source: string } }>;
    };
    expect(statusPayload.context.root).toBe(root);
    expect(statusPayload.sourceInventory.totalFiles).toBe(1);
    expect(statusPayload.coverage[0]?.selector.source).toBe("claude-code");

    const found = await runCli(["find", "source claude needle", "--source", "claude-code", "--db", dbPath, "--json"]);
    expect(found.exitCode).toBe(0);
    const findPayload = JSON.parse(found.stdout) as { results: Array<{ sessionUuid: string; sessionRef: string; cwd: string }> };
    expect(findPayload.results[0]?.sessionUuid).toBe("claude-code:cli-claude-session");
    expect(findPayload.results[0]?.sessionRef).toBe("claude-code:cli-claude-session");
    expect(findPayload.results[0]?.cwd).toBe("/tmp/source-claude");

    const listed = await runCli(["list", "--source", "claude-code", "--db", dbPath, "--json"]);
    expect(listed.exitCode).toBe(0);
    const listPayload = JSON.parse(listed.stdout) as { query: { sourceId?: string }; results: Array<{ sessionUuid: string }> };
    expect(listPayload.query.sourceId).toBe("claude-code");
    expect(listPayload.results[0]?.sessionUuid).toBe("claude-code:cli-claude-session");

    const stats = await runCli(["stats", "--source", "claude-code", "--db", dbPath, "--json"]);
    expect(stats.exitCode).toBe(0);
    const statsPayload = JSON.parse(stats.stdout) as { sessionCount: number; messageCount: number };
    expect(statsPayload.sessionCount).toBe(1);
    expect(statsPayload.messageCount).toBe(2);

    const range = await runCli([
      "read-range",
      "cli-claude-session",
      "--source",
      "claude-code",
      "--seq",
      "0",
      "--before",
      "0",
      "--after",
      "0",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(range.exitCode).toBe(0);
    const rangePayload = JSON.parse(range.stdout) as {
      session: { sourceId: string; sessionUuid: string };
      messages: Array<{ contentText: string }>;
    };
    expect(rangePayload.session.sourceId).toBe("claude-code");
    expect(rangePayload.session.sessionUuid).toBe("claude-code:cli-claude-session");
    expect(rangePayload.messages[0]?.contentText).toBe("source claude needle");

    const refRange = await runCli([
      "read-range",
      findPayload.results[0]?.sessionRef ?? "",
      "--query",
      "source claude needle",
      "--before",
      "0",
      "--after",
      "0",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(refRange.exitCode).toBe(0);
    const refRangePayload = JSON.parse(refRange.stdout) as { session: { sourceId: string; sessionUuid: string }; anchorSeq: number };
    expect(refRangePayload.session.sourceId).toBe("claude-code");
    expect(refRangePayload.session.sessionUuid).toBe("claude-code:cli-claude-session");
    expect(refRangePayload.anchorSeq).toBe(0);

    const page = await runCli([
      "read-page",
      "cli-claude-session",
      "--source",
      "claude-code",
      "--limit",
      "1",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(page.exitCode).toBe(0);
    const pagePayload = JSON.parse(page.stdout) as { session: { sourceId: string }; totalCount: number };
    expect(pagePayload.session.sourceId).toBe("claude-code");
    expect(pagePayload.totalCount).toBe(2);

    const missingClaudeRead = await runCli(["read-page", "claude-code:missing-cli-claude-session", "--limit", "1", "--db", dbPath, "--json"]);
    expect(missingClaudeRead.exitCode).toBe(1);
    const missingClaudePayload = JSON.parse(missingClaudeRead.stdout) as {
      error: { sourceId: string; nativeSessionId: string; nextAction: { commands: Array<{ argv: string[] }> } };
    };
    expect(missingClaudePayload.error.sourceId).toBe("claude-code");
    expect(missingClaudePayload.error.nativeSessionId).toBe("missing-cli-claude-session");
    expect(missingClaudePayload.error.nextAction.commands[0]?.argv).toContain("claude-code");
  });

  test("fixed commands accept explicit --source pi", async () => {
    const base = mkdtempSync(join(tmpdir(), "shlog-cli-source-pi-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const projectDir = join(root, "--tmp-source-pi--");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "conversation.jsonl"),
      [
        piLine({ type: "session", id: "cli-pi-session", cwd: "/tmp/source-pi", timestamp: "2026-06-07T00:00:00.000Z" }),
        piLine({
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-06-07T00:00:01.000Z",
          message: { role: "user", content: [{ type: "text", text: "source pi needle" }], timestamp: "2026-06-07T00:00:01.000Z" },
        }),
        piLine({
          type: "message",
          id: "a1",
          parentId: "u1",
          timestamp: "2026-06-07T00:00:02.000Z",
          message: { role: "assistant", content: [{ type: "text", text: "source pi reply" }], timestamp: "2026-06-07T00:00:02.000Z" },
        }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const synced = await runCli(["sync", "--source", "pi", "--root", root, "--db", dbPath, "--json"]);
    expect(synced.exitCode).toBe(0);
    const syncPayload = JSON.parse(synced.stdout) as { coverage: { selector: { source: string; kind: string; root: string } } };
    expect(syncPayload.coverage.selector).toEqual({ source: "pi", kind: "all", root });

    const status = await runCli(["status", "--source", "pi", "--root", root, "--db", dbPath, "--json"]);
    expect(status.exitCode).toBe(0);
    const statusPayload = JSON.parse(status.stdout) as { context: { root: string }; sourceInventory: { totalFiles: number } };
    expect(statusPayload.context.root).toBe(root);
    expect(statusPayload.sourceInventory.totalFiles).toBe(1);

    const found = await runCli(["find", "source pi needle", "--source", "pi", "--db", dbPath, "--json"]);
    expect(found.exitCode).toBe(0);
    const findPayload = JSON.parse(found.stdout) as { results: Array<{ sessionUuid: string; sessionRef: string; cwd: string }> };
    expect(findPayload.results[0]?.sessionUuid).toBe("pi:cli-pi-session");
    expect(findPayload.results[0]?.sessionRef).toBe("pi:cli-pi-session");
    expect(findPayload.results[0]?.cwd).toBe("/tmp/source-pi");

    const listed = await runCli(["list", "--source", "pi", "--db", dbPath, "--json"]);
    expect(listed.exitCode).toBe(0);
    const listPayload = JSON.parse(listed.stdout) as { query: { sourceId?: string }; results: Array<{ sessionUuid: string }> };
    expect(listPayload.query.sourceId).toBe("pi");
    expect(listPayload.results[0]?.sessionUuid).toBe("pi:cli-pi-session");

    const stats = await runCli(["stats", "--source", "pi", "--db", dbPath, "--json"]);
    expect(stats.exitCode).toBe(0);
    const statsPayload = JSON.parse(stats.stdout) as { sessionCount: number; messageCount: number };
    expect(statsPayload.sessionCount).toBe(1);
    expect(statsPayload.messageCount).toBe(2);

    const range = await runCli([
      "read-range",
      "cli-pi-session",
      "--source",
      "pi",
      "--seq",
      "0",
      "--before",
      "0",
      "--after",
      "0",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(range.exitCode).toBe(0);
    const rangePayload = JSON.parse(range.stdout) as { session: { sourceId: string; sessionUuid: string }; messages: Array<{ contentText: string }> };
    expect(rangePayload.session.sourceId).toBe("pi");
    expect(rangePayload.session.sessionUuid).toBe("pi:cli-pi-session");
    expect(rangePayload.messages[0]?.contentText).toBe("source pi needle");

    const page = await runCli(["read-page", "cli-pi-session", "--source", "pi", "--limit", "1", "--db", dbPath, "--json"]);
    expect(page.exitCode).toBe(0);
    const pagePayload = JSON.parse(page.stdout) as { session: { sourceId: string }; totalCount: number };
    expect(pagePayload.session.sourceId).toBe("pi");
    expect(pagePayload.totalCount).toBe(2);

    const refRange = await runCli([
      "read-range",
      findPayload.results[0]?.sessionRef ?? "",
      "--query",
      "source pi needle",
      "--before",
      "0",
      "--after",
      "0",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(refRange.exitCode).toBe(0);
    const refRangePayload = JSON.parse(refRange.stdout) as { session: { sourceId: string; sessionUuid: string }; anchorSeq: number };
    expect(refRangePayload.session.sourceId).toBe("pi");
    expect(refRangePayload.session.sessionUuid).toBe("pi:cli-pi-session");
    expect(refRangePayload.anchorSeq).toBe(0);

    const missingPiRead = await runCli(["read-page", "pi:missing-cli-pi-session", "--limit", "1", "--db", dbPath, "--json"]);
    expect(missingPiRead.exitCode).toBe(1);
    const missingPiPayload = JSON.parse(missingPiRead.stdout) as { error: { sourceId: string; nativeSessionId: string; nextAction: { commands: Array<{ argv: string[] }> } } };
    expect(missingPiPayload.error.sourceId).toBe("pi");
    expect(missingPiPayload.error.nativeSessionId).toBe("missing-cli-pi-session");
    expect(missingPiPayload.error.nextAction.commands[0]?.argv).toContain("pi");
  });

  test("find defaults to public cross-source search and returned session refs are directly readable", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-cross-source-find-"));
    tempDirs.push(base);

    const codexRoot = join(base, "codex-sessions");
    const codexDay = join(codexRoot, "2026", "04", "20");
    mkdirSync(codexDay, { recursive: true });
    writeFileSync(
      join(codexDay, "rollout-2026-04-20T10-00-00-15151515-1515-4515-8515-151515151515.jsonl"),
      [
        line("session_meta", { id: "15151515-1515-4515-8515-151515151515", cwd: "/tmp/cross-codex" }),
        line("event_msg", { type: "user_message", message: "cross shared codex unique" }),
      ].join("\n"),
    );

    const claudeRoot = join(base, "claude-projects");
    const claudeProject = join(claudeRoot, "synthetic-project");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      join(claudeProject, "conversation.jsonl"),
      [
        claudeLine({
          type: "user",
          sessionId: "cli-cross-claude",
          cwd: "/tmp/cross-claude",
          timestamp: "2026-06-06T00:00:00.000Z",
          message: { content: "cross shared claude unique" },
        }),
        claudeLine({
          type: "assistant",
          sessionId: "cli-cross-claude",
          cwd: "/tmp/cross-claude",
          timestamp: "2026-06-06T00:00:01.000Z",
          message: { content: "cross shared claude reply" },
        }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const codexSync = await runCli(["sync", "--source", "codex", "--root", codexRoot, "--db", dbPath, "--json"]);
    const claudeSync = await runCli(["sync", "--source", "claude-code", "--root", claudeRoot, "--db", dbPath, "--json"]);
    expect(codexSync.exitCode).toBe(0);
    expect(claudeSync.exitCode).toBe(0);

    const found = await runCli(["find", "cross shared", "--db", dbPath, "--json"]);
    expect(found.exitCode).toBe(0);
    const findPayload = JSON.parse(found.stdout) as {
      sourceIds: string[];
      results: Array<{ sourceId: string; sessionUuid: string; sessionRef: string; matchSeq: number | null }>;
    };
    expect(findPayload.sourceIds).toEqual(["codex", "claude-code", "pi"]);
    expect(findPayload.results.map((result) => result.sourceId).sort()).toEqual(["claude-code", "codex"]);
    const claudeHit = findPayload.results.find((result) => result.sourceId === "claude-code");
    expect(claudeHit?.sessionRef).toBe("claude-code:cli-cross-claude");
    expect(claudeHit?.matchSeq).toBe(0);

    const explicitCodex = await runCli(["find", "cross shared", "--source", "codex", "--db", dbPath, "--json"]);
    expect(explicitCodex.exitCode).toBe(0);
    const explicitCodexPayload = JSON.parse(explicitCodex.stdout) as {
      sourceIds: string[];
      results: Array<{ sourceId: string }>;
    };
    expect(explicitCodexPayload.sourceIds).toEqual(["codex"]);
    expect(explicitCodexPayload.results.map((result) => result.sourceId)).toEqual(["codex"]);

    const range = await runCli([
      "read-range",
      claudeHit?.sessionRef ?? "",
      "--seq",
      String(claudeHit?.matchSeq ?? 0),
      "--before",
      "0",
      "--after",
      "0",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(range.exitCode).toBe(0);
    const rangePayload = JSON.parse(range.stdout) as {
      session: { sourceId: string; sessionUuid: string };
      messages: Array<{ contentText: string }>;
    };
    expect(rangePayload.session.sourceId).toBe("claude-code");
    expect(rangePayload.session.sessionUuid).toBe("claude-code:cli-cross-claude");
    expect(rangePayload.messages[0]?.contentText).toBe("cross shared claude unique");

    const queryRange = await runCli([
      "read-range",
      claudeHit?.sessionRef ?? "",
      "--query",
      "cross shared claude unique",
      "--before",
      "0",
      "--after",
      "0",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(queryRange.exitCode).toBe(0);
    const queryRangePayload = JSON.parse(queryRange.stdout) as {
      session: { sourceId: string; sessionUuid: string };
      anchorSeq: number;
    };
    expect(queryRangePayload.session.sourceId).toBe("claude-code");
    expect(queryRangePayload.session.sessionUuid).toBe("claude-code:cli-cross-claude");
    expect(queryRangePayload.anchorSeq).toBe(0);
  });

  test("sync with cwd selector writes coverage and find stays scoped", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-selector-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "21");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-2026-04-21T10-00-00-22222222-2222-4222-8222-222222222222.jsonl"),
      [
        line("session_meta", { id: "22222222-2222-4222-8222-222222222222", cwd: "/tmp/alpha" }),
        line("event_msg", { type: "user_message", message: "shared needle alpha" }),
      ].join("\n"),
    );
    writeFileSync(
      join(day, "rollout-2026-04-21T11-00-00-33333333-3333-4333-8333-333333333333.jsonl"),
      [
        line("session_meta", { id: "33333333-3333-4333-8333-333333333333", cwd: "/tmp/beta" }),
        line("event_msg", { type: "user_message", message: "shared needle beta" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const selector = JSON.stringify({ kind: "cwd", root, cwd: "/tmp/alpha" });
    const synced = await runCli(["sync", "--selector", selector, "--db", dbPath, "--json"]);
    expect(synced.exitCode).toBe(0);
    const syncPayload = JSON.parse(synced.stdout) as { coverage: { written: boolean; selector: { kind: string; cwd?: string } } };
    expect(syncPayload.coverage.written).toBe(true);
    expect(syncPayload.coverage.selector).toMatchObject({ kind: "cwd", cwd: "/tmp/alpha" });

    const found = await runCli(["find", "shared needle", "--source", "codex", "--selector", selector, "--db", dbPath, "--json"]);
    expect(found.exitCode).toBe(0);
    const findPayload = JSON.parse(found.stdout) as {
      results: Array<{ sessionUuid: string; cwd: string }>;
      coverage: { complete: boolean; freshness: string };
    };
    expect(findPayload.coverage.complete).toBe(true);
    expect(findPayload.coverage.freshness).toBe("not_checked");
    expect(findPayload.results.map((result) => result.cwd)).toEqual(["/tmp/alpha"]);
  });

  test("sync and find support --cwd/--root without handwritten selector JSON", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-cwd-shortcut-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "21");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-2026-04-21T10-00-00-22222222-aaaa-4222-8222-222222222222.jsonl"),
      [
        line("session_meta", { id: "22222222-aaaa-4222-8222-222222222222", cwd: "/tmp/shortcut-alpha" }),
        line("event_msg", { type: "user_message", message: "shortcut needle alpha" }),
      ].join("\n"),
    );
    writeFileSync(
      join(day, "rollout-2026-04-21T11-00-00-33333333-bbbb-4333-8333-333333333333.jsonl"),
      [
        line("session_meta", { id: "33333333-bbbb-4333-8333-333333333333", cwd: "/tmp/shortcut-beta" }),
        line("event_msg", { type: "user_message", message: "shortcut needle beta" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const synced = await runCli(["sync", "--root", root, "--cwd", "/tmp/shortcut-alpha", "--db", dbPath, "--json"]);
    expect(synced.exitCode).toBe(0);
    const syncPayload = JSON.parse(synced.stdout) as { coverage: { selector: { kind: string; root: string; cwd?: string } } };
    expect(syncPayload.coverage.selector).toMatchObject({ kind: "cwd", root, cwd: "/tmp/shortcut-alpha" });

    const found = await runCli(["find", "shortcut needle", "--root", root, "--cwd", "/tmp/shortcut-alpha", "--db", dbPath, "--json"]);
    expect(found.exitCode).toBe(0);
    const findPayload = JSON.parse(found.stdout) as { results: Array<{ cwd: string }> };
    expect(findPayload.results.map((result) => result.cwd)).toEqual(["/tmp/shortcut-alpha"]);
  });

  test("sync find and list support --root as an all-root selector shortcut", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-root-shortcut-"));
    tempDirs.push(base);
    const rootA = join(base, "sessions-a");
    const rootB = join(base, "sessions-b");
    const dayA = join(rootA, "2026", "04", "21");
    const dayB = join(rootB, "2026", "04", "21");
    mkdirSync(dayA, { recursive: true });
    mkdirSync(dayB, { recursive: true });
    writeFileSync(
      join(dayA, "rollout-2026-04-21T10-00-00-aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa.jsonl"),
      [
        line("session_meta", { id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/root-shortcut-alpha" }),
        line("event_msg", { type: "user_message", message: "root shortcut shared needle alpha" }),
      ].join("\n"),
    );
    writeFileSync(
      join(dayB, "rollout-2026-04-21T11-00-00-bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb.jsonl"),
      [
        line("session_meta", { id: "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb", cwd: "/tmp/root-shortcut-beta" }),
        line("event_msg", { type: "user_message", message: "root shortcut shared needle beta" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const syncA = await runCli(["sync", "--root", rootA, "--db", dbPath, "--json"]);
    expect(syncA.exitCode).toBe(0);
    const syncPayload = JSON.parse(syncA.stdout) as { coverage: { selector: { kind: string; root: string } } };
    expect(syncPayload.coverage.selector).toEqual({ kind: "all", source: "codex", root: rootA });

    const syncB = await runCli(["sync", "--root", rootB, "--db", dbPath, "--json"]);
    expect(syncB.exitCode).toBe(0);

    const found = await runCli(["find", "root shortcut shared needle", "--root", rootB, "--db", dbPath, "--json"]);
    expect(found.exitCode).toBe(0);
    const findPayload = JSON.parse(found.stdout) as { results: Array<{ sessionUuid: string }> };
    expect(findPayload.results.map((result) => result.sessionUuid)).toEqual(["bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb"]);

    const listed = await runCli(["list", "--root", rootB, "--db", dbPath, "--json"]);
    expect(listed.exitCode).toBe(0);
    const listPayload = JSON.parse(listed.stdout) as { results: Array<{ sessionUuid: string }> };
    expect(listPayload.results.map((result) => result.sessionUuid)).toEqual(["bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb"]);
  });

  test("find text output tells agents to check coverage before giving up on zero results", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-find-zero-next-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const dbPath = join(base, "index.sqlite");
    const db = openWriteDb(dbPath);
    db.close();

    const result = await runCli([
      "find",
      "missing needle",
      "--root",
      root,
      "--cwd",
      "/tmp/missing-text-find",
      "--db",
      dbPath,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("没有找到结果");
    expect(result.stdout).toContain("next:");
    expect(result.stdout).toContain("shlog sync");
    expect(result.stdout).toContain("Retry this find");
  });

  test("list text output tells agents to check coverage before giving up on zero results", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-list-zero-next-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const dbPath = join(base, "index.sqlite");
    const db = openWriteDb(dbPath);
    db.close();

    const result = await runCli([
      "list",
      "--root",
      root,
      "--db",
      dbPath,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("没有匹配的 session");
    expect(result.stdout).toContain("next:");
    expect(result.stdout).toContain("shlog status");
    expect(result.stdout).toContain("shlog sync");
  });

  test("selector JSON can omit root when --root is provided", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-selector-default-root-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "21");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-2026-04-21T10-00-00-44444444-aaaa-4444-8444-444444444444.jsonl"),
      [
        line("session_meta", { id: "44444444-aaaa-4444-8444-444444444444", cwd: "/tmp/selector-default-root" }),
        line("event_msg", { type: "user_message", message: "default root needle" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const selectorWithoutRoot = JSON.stringify({ kind: "cwd", cwd: "/tmp/selector-default-root" });
    const synced = await runCli(["sync", "--root", root, "--selector", selectorWithoutRoot, "--db", dbPath, "--json"]);
    expect(synced.exitCode).toBe(0);

    const found = await runCli([
      "find",
      "default root needle",
      "--source",
      "codex",
      "--root",
      root,
      "--selector",
      selectorWithoutRoot,
      "--db",
      dbPath,
      "--json",
    ]);
    expect(found.exitCode).toBe(0);
    const payload = JSON.parse(found.stdout) as {
      results: Array<{ sessionUuid: string }>;
      coverage: { complete: boolean; coveringSelectors: Array<{ selector: { root: string } }> };
    };
    expect(payload.results[0]?.sessionUuid).toBe("44444444-aaaa-4444-8444-444444444444");
    expect(payload.coverage.complete).toBe(true);
    expect(payload.coverage.coveringSelectors[0]?.selector.root).toBe(root);
  });

  test("find rejects combining --selector and --cwd", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-selector-cwd-conflict-"));
    tempDirs.push(base);
    const result = await runCli([
      "find",
      "needle",
      "--selector",
      JSON.stringify({ kind: "all", root: join(base, "sessions") }),
      "--cwd",
      "/tmp/project",
      "--db",
      join(base, "index.sqlite"),
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("invalid_selector");
    expect(payload.error.message).toContain("cannot be combined");
  });

  test("status marks coverage stale when selected source files change", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-coverage-stale-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "21");
    mkdirSync(day, { recursive: true });
    const filePath = join(day, "rollout-2026-04-21T10-00-00-12121212-1212-4212-8212-121212121212.jsonl");
    writeFileSync(
      filePath,
      [
        line("session_meta", { id: "12121212-1212-4212-8212-121212121212", cwd: "/tmp/stale" }),
        line("event_msg", { type: "user_message", message: "stale before" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const selector = JSON.stringify({ kind: "cwd", root, cwd: "/tmp/stale" });
    const synced = await runCli(["sync", "--selector", selector, "--db", dbPath, "--json"]);
    expect(synced.exitCode).toBe(0);

    writeFileSync(
      filePath,
      [
        line("session_meta", { id: "12121212-1212-4212-8212-121212121212", cwd: "/tmp/stale" }),
        line("event_msg", { type: "user_message", message: "stale after" }),
      ].join("\n"),
    );

    const status = await runCli(["status", "--root", root, "--db", dbPath, "--json"]);
    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(status.stdout) as { coverage: Array<{ freshness: string }> };
    expect(payload.coverage[0]?.freshness).toBe("stale");
  });

  test("find reports stale default coverage even when stale index returns results", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-find-stale-default-"));
    tempDirs.push(base);
    const home = join(base, "home");
    const root = join(home, ".codex", "sessions");
    const day = join(root, "2026", "04", "21");
    mkdirSync(day, { recursive: true });
    const oldFile = join(day, "rollout-2026-04-21T10-00-00-14141414-1414-4414-8414-141414141414.jsonl");
    writeFileSync(
      oldFile,
      [
        line("session_meta", { id: "14141414-1414-4414-8414-141414141414", cwd: "/tmp/stale-default" }),
        line("event_msg", { type: "user_message", message: "go.link2.bond old indexed hit" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const env = { HOME: home };
    const synced = await runCli(["sync", "--db", dbPath, "--json"], { env });
    expect(synced.exitCode).toBe(0);

    writeFileSync(
      join(day, "rollout-2026-04-21T11-00-00-15151515-1515-4515-8515-151515151515.jsonl"),
      [
        line("session_meta", { id: "15151515-1515-4515-8515-151515151515", cwd: "/tmp/stale-default" }),
        line("event_msg", { type: "user_message", message: "new unsynced hit should make coverage stale" }),
      ].join("\n"),
    );

    const found = await runCli(["find", "go.link2.bond", "--source", "codex", "--db", dbPath, "--json"], { env });
    expect(found.exitCode).toBe(0);
    const payload = JSON.parse(found.stdout) as {
      results: Array<{ sessionUuid: string }>;
      nextAction?: { reason: string; selector?: { kind: string; root: string }; commands?: Array<{ argv: string[] }> };
    };
    expect(payload.results[0]?.sessionUuid).toBe("14141414-1414-4414-8414-141414141414");
    expect(payload.nextAction?.reason).toBe("stale_or_missing_coverage");
    expect(payload.nextAction?.selector).toMatchObject({ kind: "all", root });
    expect(payload.nextAction?.commands?.[0]?.argv).toEqual(["shlog", "sync", "--source", "codex", "--root", root]);
  });

  test("find does not force sync for non-empty results when only existing source content changed", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-find-active-tail-"));
    tempDirs.push(base);
    const home = join(base, "home");
    const root = join(home, ".codex", "sessions");
    const day = join(root, "2026", "04", "21");
    mkdirSync(day, { recursive: true });
    const filePath = join(day, "rollout-2026-04-21T10-00-00-16161616-1616-4616-8616-161616161616.jsonl");
    writeFileSync(
      filePath,
      [
        line("session_meta", { id: "16161616-1616-4616-8616-161616161616", cwd: "/tmp/active-tail" }),
        line("event_msg", { type: "user_message", message: "go.link2.bond indexed active tail hit" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    const env = { HOME: home };
    const synced = await runCli(["sync", "--db", dbPath, "--json"], { env });
    expect(synced.exitCode).toBe(0);

    writeFileSync(
      filePath,
      [
        line("session_meta", { id: "16161616-1616-4616-8616-161616161616", cwd: "/tmp/active-tail" }),
        line("event_msg", { type: "user_message", message: "go.link2.bond indexed active tail hit" }),
        line("event_msg", { type: "agent_message", message: "new active tail content after sync" }),
      ].join("\n"),
    );

    const found = await runCli(["find", "go.link2.bond", "--source", "codex", "--db", dbPath, "--json"], { env });
    expect(found.exitCode).toBe(0);
    const payload = JSON.parse(found.stdout) as {
      results: Array<{ sessionUuid: string }>;
      nextAction?: { reason: string };
    };
    expect(payload.results[0]?.sessionUuid).toBe("16161616-1616-4616-8616-161616161616");
    expect(payload.nextAction).toBeUndefined();
  });

  test("status --selector treats fresh all coverage as covering a cwd selector", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-coverage-all-covers-cwd-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "21");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-2026-04-21T10-00-00-13131313-1313-4313-8313-131313131313.jsonl"),
      [
        line("session_meta", { id: "13131313-1313-4313-8313-131313131313", cwd: "/tmp/covered-by-all" }),
        line("event_msg", { type: "user_message", message: "covered by all" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    await syncSessions({ dbPath, selector: { kind: "all", root } });

    const selector = JSON.stringify({ kind: "cwd", root, cwd: "/tmp/covered-by-all" });
    const status = await runCli(["status", "--root", root, "--selector", selector, "--db", dbPath, "--json"]);

    expect(status.exitCode).toBe(0);
    const payload = JSON.parse(status.stdout) as {
      requestedCoverage: {
        complete: boolean;
        freshness: string;
        recommendedAction: string;
        coveringSelectors: Array<{ selector: { kind: string } }>;
      };
    };
    expect(payload.requestedCoverage.complete).toBe(true);
    expect(payload.requestedCoverage.freshness).toBe("fresh");
    expect(payload.requestedCoverage.recommendedAction).toBe("query");
    expect(payload.requestedCoverage.coveringSelectors[0]?.selector.kind).toBe("all");
  });

  test("find text output points to read-range", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "21");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-21T10-00-00-44444444-4444-4444-8444-444444444444.jsonl"),
      [
        line("session_meta", { id: "44444444-4444-4444-8444-444444444444", cwd: "/tmp/project-d" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "user_message", message: "health check 一直失败" }),
        line("event_msg", { type: "agent_message", message: "先看 readback" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    await syncSessions({ dbPath, rootDir: join(base, "sessions") });

    const result = await runCli(["find", "health check", "--db", dbPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("next: shlog read-range 44444444-4444-4444-8444-444444444444 --seq 0");
    expect(result.stdout).not.toContain("next: cxs window");
  });

  test("read-range text keeps command evidence inside long messages", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-read-range-long-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "05", "01");
    mkdirSync(sessionsRoot, { recursive: true });

    const command = "node build/cli.js deploy fixtures/sample.jsonl --json";
    const leadIn = Array.from({ length: 80 }, (_, index) => `context-${index}`).join(" ");
    writeFileSync(
      join(sessionsRoot, "rollout-2026-05-01T10-00-00-55555555-5555-4555-8555-555555555555.jsonl"),
      [
        line("session_meta", { id: "55555555-5555-4555-8555-555555555555", cwd: "/tmp/long-command" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "agent_message", message: `${leadIn} ${command}` }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    await syncSessions({ dbPath, rootDir: join(base, "sessions") });

    const result = await runCli([
      "read-range",
      "55555555-5555-4555-8555-555555555555",
      "--seq",
      "0",
      "--before",
      "0",
      "--after",
      "0",
      "--db",
      dbPath,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(command);
  });

  test("find can sort by recent time and exclude the current session", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-find-recent-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "21");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-21T10-00-00-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl"),
      [
        lineAt("2026-04-21T10:00:00.000Z", "session_meta", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/recent-keyword" }),
        lineAt("2026-04-21T10:01:00.000Z", "event_msg", { type: "user_message", message: "$xsearch older target" }),
      ].join("\n"),
    );
    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-21T12-00-00-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl"),
      [
        lineAt("2026-04-21T12:00:00.000Z", "session_meta", { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cwd: "/tmp/recent-keyword" }),
        lineAt("2026-04-21T12:01:00.000Z", "event_msg", { type: "user_message", message: "latest question mentions xsearch" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    await syncSessions({ dbPath, rootDir: join(base, "sessions") });

    const newest = await runCli(["find", "xsearch", "--sort", "ended", "--db", dbPath, "--json"]);
    expect(newest.exitCode).toBe(0);
    const newestPayload = JSON.parse(newest.stdout) as { sort: string; results: Array<{ sessionUuid: string }> };
    expect(newestPayload.sort).toBe("ended");
    expect(newestPayload.results[0]?.sessionUuid).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    const excluded = await runCli([
      "find",
      "xsearch",
      "--sort",
      "ended",
      "--exclude-session",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "--db",
      dbPath,
      "--json",
    ]);
    expect(excluded.exitCode).toBe(0);
    const excludedPayload = JSON.parse(excluded.stdout) as { excludedSessions: string[]; results: Array<{ sessionUuid: string }> };
    expect(excludedPayload.excludedSessions).toEqual(["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
    expect(excludedPayload.results[0]?.sessionUuid).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  test("find emits friendly guidance when index is missing", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-missing-index-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");

    const result = await runCli(["find", "hi", "--db", dbPath]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`index not found: ${dbPath}`);
    expect(result.stderr).toContain("shlog sync");
    expect(result.stderr).toContain("shlog sync --cwd");
    expect(result.stderr).toContain("No separate init command is needed");
    expect(result.stderr).not.toContain("Error:");
    expect(result.stderr).not.toContain("at openReadDb");
  });

  test("stats --json emits structured guidance when index is missing", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-missing-index-json-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");

    const result = await runCli(["stats", "--json", "--db", dbPath]);

    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as {
      error: {
        code: string;
        message: string;
        dbPath: string;
        hint: string;
        nextAction: {
          kind: string;
          commands: Array<{
            label: string;
            when: string;
            recommended: boolean;
            argv: string[];
            selector: { source: string; kind: string; root: string; cwd?: string };
          }>;
        };
      };
    };
    expect(payload.error.code).toBe("index_unavailable");
    expect(payload.error.message).toContain(dbPath);
    expect(payload.error.dbPath).toBe(dbPath);
    expect(payload.error.hint).toContain("shlog sync");
    expect(payload.error.nextAction.kind).toBe("bootstrap_index");
    expect(payload.error.nextAction.commands[0]?.argv).toEqual(["shlog", "sync"]);
    expect(payload.error.nextAction.commands[0]?.recommended).toBe(true);
    expect(payload.error.nextAction.commands[0]?.selector).toMatchObject({ source: "codex", kind: "all" });
    expect(payload.error.nextAction.commands[1]?.argv.slice(0, 3)).toEqual(["shlog", "sync", "--cwd"]);
    expect(payload.error.nextAction.commands[1]?.recommended).toBe(false);
    expect(payload.error.nextAction.commands[1]?.selector).toMatchObject({ source: "codex", kind: "cwd" });
    expect(result.stderr).toBe("");
  });

  test("read-only commands emit upgrade guidance for source-unaware indexes", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-source-schema-"));
    tempDirs.push(base);
    const dbPath = join(base, "index.sqlite");
    createSourceUnawareIndex(dbPath);

    const commands = [
      ["find", "legacy"],
      ["list"],
      ["stats"],
      ["read-page", "11111111-1111-4111-8111-111111111111"],
      ["read-range", "11111111-1111-4111-8111-111111111111", "--seq", "0"],
    ];

    for (const command of commands) {
      const result = await runCli([...command, "--json", "--db", dbPath]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      const payload = JSON.parse(result.stdout) as {
        error: { code: string; message: string; dbPath: string; missingColumns: string[]; hint: string };
      };
      expect(payload.error.code).toBe("index_schema_upgrade_required");
      expect(payload.error.message).toContain(dbPath);
      expect(payload.error.dbPath).toBe(dbPath);
      expect(payload.error.missingColumns).toEqual([
        "sessions.source_id",
        "sessions.native_session_id",
        "sessions.session_key",
        "coverage.source_id",
      ]);
      expect(payload.error.hint).toContain("shlog sync --source codex");
      expect(result.stdout).not.toContain("SqliteError");
      expect(result.stdout).not.toContain("no such column");
    }
  });

  test("read-page --json emits retry guidance when a session is not indexed", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-missing-session-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "21");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-21T10-00-00-12121212-1212-4121-8121-121212121212.jsonl"),
      [
        line("session_meta", { id: "12121212-1212-4121-8121-121212121212", cwd: "/tmp/indexed" }),
        line("event_msg", { type: "user_message", message: "already indexed" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    await syncSessions({ dbPath, rootDir: join(base, "sessions") });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-21T11-00-00-34343434-3434-4343-8434-343434343434.jsonl"),
      [
        line("session_meta", { id: "34343434-3434-4343-8434-343434343434", cwd: "/tmp/not-yet-indexed" }),
        line("event_msg", { type: "user_message", message: "raw exists but index is stale" }),
      ].join("\n"),
    );

    const result = await runCli([
      "read-page",
      "34343434-3434-4343-8434-343434343434",
      "--json",
      "--db",
      dbPath,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout) as {
      error: {
        code: string;
        message: string;
        sessionRef: string;
        sourceId: string;
        nativeSessionId: string;
        hint: string;
        nextAction: {
          kind: string;
          reason: string;
          commands: Array<{ label: string; recommended: boolean; argv: string[] }>;
        };
      };
    };
    expect(payload.error.code).toBe("session_not_found");
    expect(payload.error.message).toContain("Sherlog index");
    expect(payload.error.sessionRef).toBe("codex:34343434-3434-4343-8434-343434343434");
    expect(payload.error.sourceId).toBe("codex");
    expect(payload.error.nativeSessionId).toBe("34343434-3434-4343-8434-343434343434");
    expect(payload.error.hint).toContain("raw session may exist but not be synced");
    expect(payload.error.hint).toContain("shlog status --source codex --json");
    expect(payload.error.hint).toContain("shlog sync --source codex");
    expect(payload.error.nextAction.kind).toBe("check_coverage_then_retry_read");
    expect(payload.error.nextAction.reason).toBe("session_not_found");
    expect(payload.error.nextAction.commands[0]?.argv).toEqual(["shlog", "status", "--source", "codex", "--db", dbPath, "--json"]);
    expect(payload.error.nextAction.commands[1]?.argv).toEqual(["shlog", "sync", "--source", "codex", "--db", dbPath]);
    expect(payload.error.nextAction.commands[2]?.argv).toEqual([
      "shlog",
      "read-page",
      "codex:34343434-3434-4343-8434-343434343434",
      "--offset",
      "0",
      "--limit",
      "20",
      "--db",
      dbPath,
    ]);
  });

  test("read-range --json retry guidance preserves the read-range invocation", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-missing-range-session-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "21");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-21T10-00-00-12121212-1212-4121-8121-121212121212.jsonl"),
      [
        line("session_meta", { id: "12121212-1212-4121-8121-121212121212", cwd: "/tmp/indexed" }),
        line("event_msg", { type: "user_message", message: "already indexed" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    await syncSessions({ dbPath, rootDir: join(base, "sessions") });

    const result = await runCli([
      "read-range",
      "34343434-3434-4343-8434-343434343434",
      "--seq",
      "7",
      "--before",
      "1",
      "--after",
      "3",
      "--json",
      "--db",
      dbPath,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout) as {
      error: {
        code: string;
        nextAction: {
          commands: Array<{ label: string; recommended: boolean; argv: string[] }>;
        };
      };
    };
    expect(payload.error.code).toBe("session_not_found");
    expect(payload.error.nextAction.commands[2]?.argv).toEqual([
      "shlog",
      "read-range",
      "codex:34343434-3434-4343-8434-343434343434",
      "--seq",
      "7",
      "--before",
      "1",
      "--after",
      "3",
      "--db",
      dbPath,
    ]);
  });

  test("list filters by cwd substring and respects sort", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-list-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "21");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-21T10-00-00-55555555-5555-4555-8555-555555555555.jsonl"),
      [
        line("session_meta", { id: "55555555-5555-4555-8555-555555555555", cwd: "/tmp/alpha-proj" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "user_message", message: "alpha one" }),
      ].join("\n"),
    );

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-21T11-00-00-66666666-6666-4666-8666-666666666666.jsonl"),
      [
        line("session_meta", { id: "66666666-6666-4666-8666-666666666666", cwd: "/tmp/beta-proj" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "user_message", message: "beta one" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    await syncSessions({ dbPath, rootDir: join(base, "sessions") });

    const listed = await runCli(["list", "--cwd", "alpha", "--json", "--db", dbPath]);
    expect(listed.exitCode).toBe(0);
    const payload = JSON.parse(listed.stdout) as { results: Array<{ sessionUuid: string }> };
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]?.sessionUuid).toBe("55555555-5555-4555-8555-555555555555");
  });

  test("stats reports counts and index_version", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-stats-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "21");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-21T10-00-00-77777777-7777-4777-8777-777777777777.jsonl"),
      [
        line("session_meta", { id: "77777777-7777-4777-8777-777777777777", cwd: "/tmp/gamma" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "user_message", message: "gamma one" }),
        line("event_msg", { type: "agent_message", message: "gamma reply" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    await syncSessions({ dbPath, rootDir: join(base, "sessions") });

    const stats = await runCli(["stats", "--json", "--db", dbPath]);
    expect(stats.exitCode).toBe(0);
    const payload = JSON.parse(stats.stdout) as {
      sessionCount: number;
      messageCount: number;
      indexVersion: string;
      topCwds: Array<{ cwd: string; count: number }>;
    };
    expect(payload.sessionCount).toBe(1);
    expect(payload.messageCount).toBe(2);
    expect(payload.indexVersion).toBe(INDEX_VERSION);
    expect(payload.topCwds[0]?.cwd).toBe("/tmp/gamma");
  });

  test("read-page JSON exposes totalCount and hasMore", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-page-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "21");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-21T10-00-00-88888888-8888-4888-8888-888888888888.jsonl"),
      [
        line("session_meta", { id: "88888888-8888-4888-8888-888888888888", cwd: "/tmp/pagecheck" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "user_message", message: "m1" }),
        line("event_msg", { type: "agent_message", message: "m2" }),
        line("event_msg", { type: "user_message", message: "m3" }),
        line("event_msg", { type: "agent_message", message: "m4" }),
      ].join("\n"),
    );

    const dbPath = join(base, "index.sqlite");
    await syncSessions({ dbPath, rootDir: join(base, "sessions") });

    const page1 = await runCli([
      "read-page",
      "88888888-8888-4888-8888-888888888888",
      "--offset",
      "0",
      "--limit",
      "2",
      "--json",
      "--db",
      dbPath,
    ]);
    expect(page1.exitCode).toBe(0);
    const payload1 = JSON.parse(page1.stdout) as { totalCount: number; hasMore: boolean };
    expect(payload1.totalCount).toBe(4);
    expect(payload1.hasMore).toBe(true);

    const page2 = await runCli([
      "read-page",
      "88888888-8888-4888-8888-888888888888",
      "--offset",
      "2",
      "--limit",
      "2",
      "--json",
      "--db",
      dbPath,
    ]);
    expect(page2.exitCode).toBe(0);
    const payload2 = JSON.parse(page2.stdout) as { totalCount: number; hasMore: boolean };
    expect(payload2.totalCount).toBe(4);
    expect(payload2.hasMore).toBe(false);
  });

  test("sync exits non-zero by default when per-file indexing fails", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cli-sync-"));
    tempDirs.push(base);
    const sessionsRoot = join(base, "sessions", "2026", "04", "22");
    mkdirSync(sessionsRoot, { recursive: true });

    writeFileSync(
      join(sessionsRoot, "rollout-2026-04-22T12-00-00-99990000-9999-4999-8999-999999999999.jsonl"),
      [
        line("session_meta", { id: "99990000-9999-4999-8999-999999999999", cwd: "/tmp/good" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "user_message", message: "good session" }),
      ].join("\n"),
    );

    const badFilePath = join(
      sessionsRoot,
      "rollout-2026-04-22T13-00-00-88880000-8888-4888-8888-888888888888.jsonl",
    );
    writeFileSync(
      badFilePath,
      [
        line("session_meta", { id: "88880000-8888-4888-8888-888888888888", cwd: "/tmp/bad" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "user_message", message: "bad session" }),
      ].join("\n"),
    );
    chmodSync(badFilePath, 0o000);
    unreadableFiles.push(badFilePath);

    const result = await runCli([
      "sync",
      "--selector",
      JSON.stringify({ kind: "all", root: join(base, "sessions") }),
      "--db",
      join(base, "index.sqlite"),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("errors:   1");
    expect(result.stdout).toContain(badFilePath);
  });
});

function line(type: string, payload: Record<string, unknown>): string {
  return lineAt(new Date("2026-04-21T00:00:00.000Z").toISOString(), type, payload);
}

function lineAt(timestamp: string, type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp,
    type,
    payload,
  });
}

function createSourceUnawareIndex(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_uuid TEXT NOT NULL UNIQUE,
        file_path TEXT NOT NULL UNIQUE,
        source_root TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        summary_text TEXT NOT NULL DEFAULT '',
        compact_text TEXT NOT NULL DEFAULT '',
        reasoning_summary_text TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        path_date TEXT NOT NULL DEFAULT '',
        message_count INTEGER NOT NULL DEFAULT 0,
        raw_file_mtime INTEGER NOT NULL DEFAULT 0,
        raw_file_size INTEGER NOT NULL DEFAULT 0,
        index_version TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE coverage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        selector_key TEXT NOT NULL UNIQUE,
        selector_json TEXT NOT NULL,
        selector_kind TEXT NOT NULL,
        root TEXT NOT NULL,
        cwd TEXT,
        from_date TEXT,
        to_date TEXT,
        source_fingerprint TEXT NOT NULL,
        source_file_count INTEGER NOT NULL,
        indexed_session_count INTEGER NOT NULL,
        completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        index_version TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }
}

async function runCli(
  args: string[],
  options: { env?: Record<string, string> } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // Spawn cli.ts via tsx so the test works under both Bun (via bunx) and
  // Node (via npx tsx) without requiring a build step. process.execPath
  // resolves to the runtime that's running vitest.
  return runExecutable(process.execPath, ["--import", "tsx", "cli.ts", ...args], import.meta.dirname, options);
}

async function runExecutable(
  executable: string,
  args: string[],
  cwd = import.meta.dirname,
  options: { env?: Record<string, string> } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = childSpawn(executable, args, { cwd, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout!.setEncoding("utf8");
    proc.stderr!.setEncoding("utf8");
    proc.stdout!.on("data", (chunk: string) => { stdout += chunk; });
    proc.stderr!.on("data", (chunk: string) => { stderr += chunk; });
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}

function claudeLine(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

function piLine(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}
