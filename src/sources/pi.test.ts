import { afterEach, describe, expect, test } from "vitest";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { syncSessions } from "../indexer";
import { findSessions } from "../query/find";
import { getMessagePage } from "../query/read";
import { collectStatus } from "../status";
import { getSessionSourceAdapter, listSessionSourceAdapters } from ".";
import { acceptedPiSessionRecord } from "./pi-policy";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pi source adapter", () => {
  test("is registered as a public adapter while Codex remains the default", () => {
    const adapter = getSessionSourceAdapter("pi");

    expect(getSessionSourceAdapter().id).toBe("codex");
    expect(adapter.id).toBe("pi");
    expect(adapter.public).toBe(true);
    expect(listSessionSourceAdapters().map((source) => source.id)).toEqual(["codex", "claude-code", "pi"]);
    expect(listSessionSourceAdapters().filter((source) => source.public).map((source) => source.id)).toEqual([
      "codex",
      "claude-code",
      "pi",
    ]);
  });

  test("rejects an explicit selector source mismatch before syncing or writing coverage", async () => {
    const { root } = writePiFixture("selector-mismatch", [
      piLine({ type: "session", id: "pi-accepted-session", cwd: "/tmp/pi-accepted-cwd", timestamp: "2026-06-06T00:00:00.000Z" }),
      piLine({
        type: "message",
        timestamp: "2026-06-06T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "accepted text" }], timestamp: "2026-06-06T00:00:01.000Z" },
      }),
    ]);
    const dbPath = join(root, "index.sqlite");

    let failure: unknown = null;
    try {
      await syncSessions({
        dbPath,
        sourceId: "pi",
        selector: { source: "codex", kind: "all", root },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("selector.source must match session source pi");
    expect(existsSync(dbPath)).toBe(false);
  });

  test("accepts Pi session metadata with optional id for fallback sessions", () => {
    expect(acceptedPiSessionRecord({ type: "session", id: "pi-session", cwd: "", timestamp: "2026-06-06T00:00:00.000Z" })).toBeNull();
    expect(acceptedPiSessionRecord({ type: "session", id: "pi-session", cwd: "/tmp/pi" })).toBeNull();
    expect(acceptedPiSessionRecord({ type: "session", cwd: "/tmp/pi-fallback", timestamp: "2026-06-06T00:00:00.000Z" })).toEqual({
      sessionId: "",
      cwd: "/tmp/pi-fallback",
      timestamp: "2026-06-06T00:00:00.000Z",
    });
    expect(acceptedPiSessionRecord({ type: "session", id: " pi-session ", cwd: " /tmp/pi ", timestamp: " 2026-06-06T00:00:00.000Z " })).toEqual({
      sessionId: "pi-session",
      cwd: "/tmp/pi",
      timestamp: "2026-06-06T00:00:00.000Z",
    });
  });

  test("parses Pi sessions without leaking tool results, thinking, or tool calls", async () => {
    const { filePath } = writePiFixture("parser-policy", [
      piLine({ type: "session", id: "pi-parser-session", cwd: "/tmp/pi-cwd", timestamp: "2026-06-06T00:00:00.000Z" }),
      piLine({ type: "model_change", id: "m1", parentId: null, timestamp: "2026-06-06T00:00:00.100Z", provider: "test", modelId: "pi-model" }),
      piLine({
        type: "message",
        timestamp: "2026-06-06T00:00:01.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "accepted pi user text" },
            { type: "thinking", thinking: "user thinking must not leak" },
          ],
          timestamp: "2026-06-06T00:00:01.000Z",
        },
      }),
      piLine({
        type: "message",
        timestamp: "2026-06-06T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "assistant thinking must not leak" },
            { type: "text", text: "accepted pi assistant text" },
            { type: "toolCall", name: "bash", arguments: { command: "tool call must not leak" } },
          ],
          timestamp: "2026-06-06T00:00:02.000Z",
        },
      }),
      piLine({
        type: "message",
        timestamp: "2026-06-06T00:00:03.000Z",
        message: { role: "toolResult", content: [{ type: "text", text: "tool result must not leak" }], timestamp: "2026-06-06T00:00:03.000Z" },
      }),
      piLine({ type: "compaction", id: "c1", timestamp: "2026-06-06T00:00:04.000Z", summary: "accepted pi compaction summary" }),
    ]);
    const adapter = getSessionSourceAdapter("pi");

    const parsed = await adapter.parseFile({
      filePath,
      cwd: "/tmp/file-cwd-fallback",
      pathDate: "2026-06-06",
      mtimeMs: 0,
      size: 0,
    });

    expect(parsed.kind).toBe("parsed");
    if (parsed.kind !== "parsed") return;
    expect(parsed.session.nativeSessionId).toBe("pi-parser-session");
    expect(parsed.session.sessionKey).toBe("pi:pi-parser-session");
    expect(parsed.session.sessionUuid).toBe("pi:pi-parser-session");
    expect(parsed.session.cwd).toBe("/tmp/pi-cwd");
    expect(parsed.session.model).toBe("pi-model");
    expect(parsed.session.startedAt).toBe("2026-06-06T00:00:00.000Z");
    expect(parsed.session.endedAt).toBe("2026-06-06T00:00:04.000Z");
    expect(parsed.session.compactText).toBe("accepted pi compaction summary");
    expect(parsed.session.messages.map((message) => message.contentText)).toEqual([
      "accepted pi user text",
      "accepted pi assistant text",
    ]);

    const searchableProjection = JSON.stringify(parsed.session);
    expect(searchableProjection).not.toContain("tool result must not leak");
    expect(searchableProjection).not.toContain("thinking must not leak");
    expect(searchableProjection).not.toContain("tool call must not leak");
  });

  test("sync skips malformed and unsupported records without leaking format-drift text", async () => {
    const { root } = writePiFixture("format-drift", [
      "{this is not json",
      piLine({ type: "session", id: "pi-format-drift-session", cwd: "/tmp/pi-format-cwd", timestamp: "2026-06-10T00:00:00.000Z" }),
      piLine({ type: "future_event", timestamp: "1999-01-01T00:00:00.000Z", text: "unsupported pi text must not leak" }),
      piLine({
        type: "message",
        timestamp: "2026-06-10T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "accepted pi format drift needle" }], timestamp: "2026-06-10T00:00:01.000Z" },
      }),
      "{\"type\":\"message\",\"message\":",
      piLine({
        type: "message",
        timestamp: "2026-06-10T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "accepted pi format drift answer" },
            { type: "toolCall", name: "bash", arguments: { command: "format drift tool call must not leak" } },
          ],
          timestamp: "2026-06-10T00:00:02.000Z",
        },
      }),
      piLine({ type: "compaction", id: "c1", timestamp: "2026-06-10T00:00:03.000Z", summary: "accepted pi format drift summary" }),
    ]);
    const dbPath = join(root, "index.sqlite");

    const summary = await syncSessions({
      dbPath,
      sourceId: "pi",
      selector: { source: "pi", kind: "all", root },
    });

    expect(summary.errors).toBe(0);
    expect(summary.added).toBe(1);
    expect(summary.coverage.sourceFileCount).toBe(1);
    expect(summary.coverage.indexedSessionCount).toBe(1);

    const foundAccepted = findSessions(dbPath, "accepted pi format drift needle", 10, { source: "pi", kind: "all", root }, { sourceId: "pi" });
    expect(foundAccepted.results.map((result) => result.sessionUuid)).toEqual(["pi:pi-format-drift-session"]);

    const foundCompaction = findSessions(dbPath, "accepted pi format drift summary", 10, { source: "pi", kind: "all", root }, { sourceId: "pi" });
    expect(foundCompaction.results.map((result) => result.sessionUuid)).toEqual(["pi:pi-format-drift-session"]);
    expect(foundCompaction.results[0]?.matchSource).toBe("session");

    const foundUnsupported = findSessions(dbPath, "unsupported pi text", 10, { source: "pi", kind: "all", root }, { sourceId: "pi" });
    expect(foundUnsupported.results).toEqual([]);

    const page = getMessagePage(dbPath, "pi:pi-format-drift-session", 0, 10);
    expect(page.session.cwd).toBe("/tmp/pi-format-cwd");
    expect(page.messages.map((message) => message.contentText)).toEqual([
      "accepted pi format drift needle",
      "accepted pi format drift answer",
    ]);
    expect(JSON.stringify(page)).not.toContain("unsupported pi text must not leak");
    expect(JSON.stringify(page)).not.toContain("format drift tool call must not leak");
  });

  test("uses the latest Pi model_change as session model", async () => {
    const { filePath } = writePiFixture("latest-model", [
      piLine({ type: "session", id: "pi-model-session", cwd: "/tmp/pi-model-cwd", timestamp: "2026-06-06T00:00:00.000Z" }),
      piLine({ type: "model_change", id: "m1", parentId: null, timestamp: "2026-06-06T00:00:00.100Z", provider: "local", modelId: "local-default" }),
      piLine({ type: "model_change", id: "m2", parentId: "m1", timestamp: "2026-06-06T00:00:00.200Z", provider: "rs", modelId: "actual-remote" }),
      piLine({
        type: "message",
        timestamp: "2026-06-06T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "latest model needle" }] },
      }),
    ]);
    const adapter = getSessionSourceAdapter("pi");

    const parsed = await adapter.parseFile({
      filePath,
      cwd: "/tmp/file-cwd-fallback",
      pathDate: "2026-06-06",
      mtimeMs: 0,
      size: 0,
    });

    expect(parsed.kind).toBe("parsed");
    if (parsed.kind !== "parsed") return;
    expect(parsed.session.model).toBe("actual-remote");
  });

  test("inventories and snapshots Pi sessions by cwd and path date", async () => {
    const { root, filePath } = writePiFixture("inventory-policy", [
      piLine({ type: "session", id: "pi-inventory-session", cwd: "/tmp/pi-inventory-cwd", timestamp: "2026-06-07T00:00:00.000Z" }),
      piLine({
        type: "message",
        timestamp: "2026-06-07T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "accepted pi inventory text" }] },
      }),
    ]);
    const adapter = getSessionSourceAdapter("pi");

    const inventory = await adapter.collectInventory(root);
    expect(inventory.totalFiles).toBe(1);
    expect(inventory.pathDateRange).toEqual({ from: "2026-06-07", to: "2026-06-07" });
    expect(inventory.cwdGroups).toEqual([
      {
        cwd: "/tmp/pi-inventory-cwd",
        fileCount: 1,
        pathDateRange: { from: "2026-06-07", to: "2026-06-07" },
      },
    ]);

    const acceptedSnapshot = await adapter.collectSnapshot({
      source: "pi",
      kind: "cwd",
      root,
      cwd: "/tmp/pi-inventory-cwd",
    });
    expect(acceptedSnapshot.fileCount).toBe(1);
    expect(acceptedSnapshot.files[0]).toMatchObject({
      filePath,
      cwd: "/tmp/pi-inventory-cwd",
      pathDate: "2026-06-07",
    });

    const skippedSnapshot = await adapter.collectSnapshot({
      source: "pi",
      kind: "cwd",
      root,
      cwd: "/tmp/other-cwd",
    });
    expect(skippedSnapshot.fileCount).toBe(0);
  });

  test("syncs and finds compaction-only Pi sessions as session-level recall", async () => {
    const { root } = writePiFixture("compaction-only", [
      piLine({ type: "session", id: "pi-compaction-session", cwd: "/tmp/pi-compact-cwd", timestamp: "2026-06-08T00:00:00.000Z" }),
      piLine({ type: "compaction", id: "c1", timestamp: "2026-06-08T00:00:03.000Z", summary: "compaction-only pi summary needle" }),
    ]);
    const dbPath = join(root, "index.sqlite");

    const summary = await syncSessions({
      dbPath,
      sourceId: "pi",
      selector: { source: "pi", kind: "all", root },
    });

    expect(summary.errors).toBe(0);
    expect(summary.added).toBe(1);
    expect(summary.coverage.sourceFileCount).toBe(1);
    expect(summary.coverage.indexedSessionCount).toBe(1);

    const found = findSessions(dbPath, "compaction-only pi summary needle", 10, { source: "pi", kind: "all", root }, { sourceId: "pi" });
    expect(found.results.map((result) => result.sessionUuid)).toEqual(["pi:pi-compaction-session"]);
    expect(found.results[0]?.matchSource).toBe("session");

    const page = getMessagePage(dbPath, "pi:pi-compaction-session", 0, 10);
    expect(page.session.sourceId).toBe("pi");
    expect(page.session.nativeSessionId).toBe("pi-compaction-session");
    expect(page.session.cwd).toBe("/tmp/pi-compact-cwd");
    expect(page.totalCount).toBe(0);
    expect(page.messages).toEqual([]);
  });

  test("syncs, finds, and reads Pi sessions without entering the Codex default source", async () => {
    const { root } = writePiFixture("sync-read", [
      piLine({ type: "session", id: "pi-sync-session", cwd: "/tmp/pi-sync-cwd", timestamp: "2026-06-08T00:00:00.000Z" }),
      piLine({
        type: "message",
        timestamp: "2026-06-08T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "private pi sync needle" }] },
      }),
      piLine({
        type: "message",
        timestamp: "2026-06-08T00:00:02.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "private pi sync answer" }] },
      }),
      piLine({ type: "compaction", id: "c1", timestamp: "2026-06-08T00:00:03.000Z", summary: "private pi compact needle" }),
    ]);
    const dbPath = join(root, "index.sqlite");

    const summary = await syncSessions({
      dbPath,
      sourceId: "pi",
      selector: { source: "pi", kind: "all", root },
    });

    expect(summary.errors).toBe(0);
    expect(summary.added).toBe(1);
    expect(summary.coverage.written).toBe(true);
    expect(summary.coverage.selector).toEqual({ source: "pi", kind: "all", root });
    expect(summary.coverage.sourceFileCount).toBe(1);
    expect(summary.coverage.indexedSessionCount).toBe(1);

    const foundPi = findSessions(dbPath, "private pi sync needle", 10, { source: "pi", kind: "all", root }, { sourceId: "pi" });
    expect(foundPi.results.map((result) => result.sessionUuid)).toEqual(["pi:pi-sync-session"]);

    const foundCompaction = findSessions(dbPath, "private pi compact needle", 10, { source: "pi", kind: "all", root }, { sourceId: "pi" });
    expect(foundCompaction.results.map((result) => result.sessionUuid)).toEqual(["pi:pi-sync-session"]);
    expect(foundCompaction.results[0]?.matchSource).toBe("session");

    const foundCodexDefault = findSessions(dbPath, "private pi sync needle", 10);
    expect(foundCodexDefault.results).toEqual([]);

    const page = getMessagePage(dbPath, "pi:pi-sync-session", 0, 10);
    expect(page.session.sourceId).toBe("pi");
    expect(page.session.nativeSessionId).toBe("pi-sync-session");
    expect(page.session.cwd).toBe("/tmp/pi-sync-cwd");
    expect(page.messages.map((message) => message.contentText)).toEqual([
      "private pi sync needle",
      "private pi sync answer",
    ]);
  });

  test("marks Pi coverage stale when a large session file grows after sync", async () => {
    const filler = "x".repeat(80_000);
    const { root, filePath } = writePiFixture("freshness-after-append", [
      piLine({ type: "session", id: "pi-freshness-session", cwd: "/tmp/pi-freshness-cwd", timestamp: "2026-06-09T00:00:00.000Z" }),
      piLine({
        type: "message",
        timestamp: "2026-06-09T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "initial pi freshness needle" }] },
      }),
      piLine({
        type: "message",
        timestamp: "2026-06-09T00:00:01.500Z",
        message: { role: "assistant", content: [{ type: "thinking", thinking: filler }] },
      }),
    ]);
    const dbPath = join(root, "index.sqlite");
    const adapter = getSessionSourceAdapter("pi");
    const selector = { source: "pi" as const, kind: "all" as const, root };

    const synced = await syncSessions({ dbPath, sourceId: "pi", selector });
    const beforeSnapshot = await adapter.collectSnapshot(selector);

    appendFileSync(
      filePath,
      `${piLine({
        type: "message",
        timestamp: "2026-06-09T00:00:02.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "late appended pi freshness needle" }] },
      })}\n`,
    );

    const afterSnapshot = await adapter.collectSnapshot(selector);
    const foundBeforeResync = findSessions(dbPath, "late appended pi freshness needle", 10, selector, { sourceId: "pi" });
    const status = await collectStatus({ sourceId: "pi", rootDir: root, dbPath, selector });

    expect(synced.coverage.sourceFingerprint).toBe(beforeSnapshot.fingerprint);
    expect(afterSnapshot.fingerprint).not.toBe(beforeSnapshot.fingerprint);
    expect(status.requestedCoverage?.freshness).toBe("stale");
    expect(status.requestedCoverage?.recommendedAction).toBe("sync");
    expect(foundBeforeResync.results).toEqual([]);
  });

  test("syncs Pi sessions whose first accepted message line exceeds the metadata scan window", async () => {
    const longNeedle = `first accepted pi long needle ${"x".repeat(70_000)} tail`;
    const { root } = writePiFixture("long-first-message", [
      piLine({ type: "session", id: "pi-long-first-session", cwd: "/tmp/pi-long-first-cwd", timestamp: "2026-06-09T00:00:00.000Z" }),
      piLine({
        type: "message",
        timestamp: "2026-06-09T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: longNeedle }] },
      }),
    ]);
    const dbPath = join(root, "index.sqlite");

    const summary = await syncSessions({
      dbPath,
      sourceId: "pi",
      selector: { source: "pi", kind: "all", root },
    });

    expect(summary.errors).toBe(0);
    expect(summary.added).toBe(1);
    expect(summary.coverage.sourceFileCount).toBe(1);
    expect(summary.coverage.indexedSessionCount).toBe(1);

    const found = findSessions(dbPath, "first accepted pi long needle", 10, { source: "pi", kind: "all", root }, { sourceId: "pi" });
    expect(found.results.map((result) => result.sessionUuid)).toEqual(["pi:pi-long-first-session"]);
  });

  test("fallback session ids stay unique when different directories share the same file name", async () => {
    const { root } = writePiFixtureTree("fallback-session-id", [
      {
        relativePath: "--tmp-alpha--/conversation.jsonl",
        lines: [
          piLine({ type: "session", cwd: "/tmp/alpha-cwd", timestamp: "2026-06-09T00:00:00.000Z" }),
          piLine({ type: "message", timestamp: "2026-06-09T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "alpha pi fallback needle" }] } }),
        ],
      },
      {
        relativePath: "--tmp-beta--/conversation.jsonl",
        lines: [
          piLine({ type: "session", cwd: "/tmp/beta-cwd", timestamp: "2026-06-09T00:00:02.000Z" }),
          piLine({ type: "message", timestamp: "2026-06-09T00:00:03.000Z", message: { role: "user", content: [{ type: "text", text: "beta pi fallback needle" }] } }),
        ],
      },
    ]);
    const dbPath = join(root, "index.sqlite");

    const summary = await syncSessions({
      dbPath,
      sourceId: "pi",
      selector: { source: "pi", kind: "all", root },
    });

    expect(summary.added).toBe(2);
    expect(summary.coverage.indexedSessionCount).toBe(2);

    const foundAlpha = findSessions(dbPath, "alpha pi fallback needle", 10, { source: "pi", kind: "all", root }, { sourceId: "pi" });
    const foundBeta = findSessions(dbPath, "beta pi fallback needle", 10, { source: "pi", kind: "all", root }, { sourceId: "pi" });

    expect(foundAlpha.results).toHaveLength(1);
    expect(foundBeta.results).toHaveLength(1);
    expect(foundAlpha.results[0]?.sessionUuid).not.toBe(foundBeta.results[0]?.sessionUuid);
    expect(foundAlpha.results[0]?.cwd).toBe("/tmp/alpha-cwd");
    expect(foundBeta.results[0]?.cwd).toBe("/tmp/beta-cwd");
    expect(foundAlpha.results[0]?.sessionUuid).toMatch(/^pi:conversation-[0-9a-f]{64}$/);
    expect(foundBeta.results[0]?.sessionUuid).toMatch(/^pi:conversation-[0-9a-f]{64}$/);
  });
});

function writePiFixture(name: string, lines: string[]): { root: string; filePath: string } {
  const base = mkdtempSync(join(tmpdir(), `shlog-pi-${name}-`));
  tempDirs.push(base);
  const root = join(base, "sessions", "--tmp-pi-project--");
  mkdirSync(root, { recursive: true });
  const filePath = join(root, `${name}.jsonl`);
  writeFileSync(filePath, `${lines.join("\n")}\n`);
  return { root: resolve(join(base, "sessions")), filePath };
}

function writePiFixtureTree(name: string, files: Array<{ relativePath: string; lines: string[] }>): { root: string } {
  const base = mkdtempSync(join(tmpdir(), `shlog-pi-tree-${name}-`));
  tempDirs.push(base);
  const root = resolve(join(base, "sessions"));

  for (const file of files) {
    const filePath = join(root, file.relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${file.lines.join("\n")}\n`);
  }

  return { root };
}

function piLine(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}
