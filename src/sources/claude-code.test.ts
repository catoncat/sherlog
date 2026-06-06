import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { syncSessions } from "../indexer";
import { findSessions } from "../query/find";
import { getMessagePage } from "../query/read";
import { getSessionSourceAdapter, listSessionSourceAdapters } from ".";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("claude-code source adapter", () => {
  test("is registered as a private non-public adapter", () => {
    const adapter = getSessionSourceAdapter("claude-code");

    expect(adapter.id).toBe("claude-code");
    expect(adapter.public).toBe(false);
    expect(listSessionSourceAdapters().map((source) => source.id)).toEqual(["codex", "claude-code"]);
    expect(listSessionSourceAdapters().filter((source) => source.public).map((source) => source.id)).toEqual(["codex"]);
  });

  test("rejects an explicit selector source mismatch before syncing or writing coverage", async () => {
    const { root } = writeClaudeFixture("selector-mismatch", [
      claudeLine({
        type: "user",
        sessionId: "accepted-session",
        cwd: "/tmp/accepted-cwd",
        timestamp: "2026-06-03T00:00:00.000Z",
        message: { content: "accepted text" },
      }),
    ]);
    const dbPath = join(root, "index.sqlite");

    let failure: unknown = null;
    try {
      await syncSessions({
        dbPath,
        sourceId: "claude-code",
        selector: { source: "codex", kind: "all", root },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("selector.source must match session source claude-code");
    expect(existsSync(dbPath)).toBe(false);
  });

  test("ignores skipped records when deriving parser identity cwd timestamps and projections", async () => {
    const { filePath } = writeClaudeFixture("parser-policy", [
      claudeLine({
        type: "user",
        isMeta: true,
        sessionId: "meta-session-must-not-win",
        cwd: "/tmp/meta-cwd-must-not-win",
        timestamp: "1999-01-01T00:00:00.000Z",
        message: { content: "meta text must not leak" },
      }),
      claudeLine({
        type: "assistant",
        isSidechain: true,
        sessionId: "sidechain-session-must-not-win",
        cwd: "/tmp/sidechain-cwd-must-not-win",
        timestamp: "1999-01-02T00:00:00.000Z",
        message: { content: "sidechain text must not leak" },
      }),
      claudeLine({
        type: "user",
        sessionId: "accepted-session",
        cwd: "/tmp/accepted-cwd",
        timestamp: "2026-06-03T00:00:00.000Z",
        message: {
          content: [
            { type: "text", text: "accepted user text" },
            { type: "tool_result", content: "tool result must not leak" },
            { type: "thinking", thinking: "thinking must not leak" },
            { type: "attachment", text: "attachment text must not leak" },
          ],
        },
      }),
      claudeLine({
        type: "assistant",
        sessionId: "accepted-session",
        cwd: "/tmp/accepted-cwd",
        timestamp: "2026-06-03T00:00:01.000Z",
        message: { content: "accepted assistant text" },
      }),
    ]);
    const adapter = getSessionSourceAdapter("claude-code");

    const parsed = await adapter.parseFile({
      filePath,
      cwd: "/tmp/file-cwd-fallback",
      pathDate: "2026-06-03",
      mtimeMs: 0,
      size: 0,
    });

    expect(parsed.kind).toBe("parsed");
    if (parsed.kind !== "parsed") return;
    expect(parsed.session.nativeSessionId).toBe("accepted-session");
    expect(parsed.session.sessionKey).toBe("claude-code:accepted-session");
    expect(parsed.session.sessionUuid).toBe("claude-code:accepted-session");
    expect(parsed.session.cwd).toBe("/tmp/accepted-cwd");
    expect(parsed.session.startedAt).toBe("2026-06-03T00:00:00.000Z");
    expect(parsed.session.endedAt).toBe("2026-06-03T00:00:01.000Z");
    expect(parsed.session.messages.map((message) => message.contentText)).toEqual([
      "accepted user text",
      "accepted assistant text",
    ]);

    const searchableProjection = JSON.stringify(parsed.session);
    expect(searchableProjection).not.toContain("meta-session-must-not-win");
    expect(searchableProjection).not.toContain("sidechain-session-must-not-win");
    expect(searchableProjection).not.toContain("/tmp/meta-cwd-must-not-win");
    expect(searchableProjection).not.toContain("/tmp/sidechain-cwd-must-not-win");
    expect(searchableProjection).not.toContain("1999-01-01");
    expect(searchableProjection).not.toContain("1999-01-02");
    expect(searchableProjection).not.toContain("meta text must not leak");
    expect(searchableProjection).not.toContain("sidechain text must not leak");
    expect(searchableProjection).not.toContain("tool result must not leak");
    expect(searchableProjection).not.toContain("thinking must not leak");
    expect(searchableProjection).not.toContain("attachment text must not leak");
  });

  test("ignores skipped records when deriving inventory grouping dates and snapshot file metadata", async () => {
    const { root, filePath } = writeClaudeFixture("inventory-policy", [
      claudeLine({
        type: "user",
        isMeta: true,
        cwd: "/tmp/meta-cwd-must-not-group",
        timestamp: "1999-01-01T00:00:00.000Z",
        message: { content: "meta inventory text must not leak" },
      }),
      claudeLine({
        type: "assistant",
        isSidechain: true,
        cwd: "/tmp/sidechain-cwd-must-not-group",
        timestamp: "1999-01-02T00:00:00.000Z",
        message: { content: "sidechain inventory text must not leak" },
      }),
      claudeLine({
        type: "user",
        sessionId: "inventory-session",
        cwd: "/tmp/accepted-inventory-cwd",
        timestamp: "2026-06-04T00:00:00.000Z",
        message: { content: "accepted inventory text" },
      }),
    ]);
    const adapter = getSessionSourceAdapter("claude-code");

    const inventory = await adapter.collectInventory(root);
    expect(inventory.totalFiles).toBe(1);
    expect(inventory.pathDateRange).toEqual({ from: "2026-06-04", to: "2026-06-04" });
    expect(inventory.cwdGroups).toEqual([
      {
        cwd: "/tmp/accepted-inventory-cwd",
        fileCount: 1,
        pathDateRange: { from: "2026-06-04", to: "2026-06-04" },
      },
    ]);

    const acceptedSnapshot = await adapter.collectSnapshot({
      source: "claude-code",
      kind: "cwd",
      root,
      cwd: "/tmp/accepted-inventory-cwd",
    });
    expect(acceptedSnapshot.fileCount).toBe(1);
    expect(acceptedSnapshot.files[0]).toMatchObject({
      filePath,
      cwd: "/tmp/accepted-inventory-cwd",
      pathDate: "2026-06-04",
    });

    const skippedSnapshot = await adapter.collectSnapshot({
      source: "claude-code",
      kind: "cwd",
      root,
      cwd: "/tmp/meta-cwd-must-not-group",
    });
    expect(skippedSnapshot.fileCount).toBe(0);
  });

  test("programmatic private sync and read use only accepted synthetic records", async () => {
    const { root } = writeClaudeFixture("sync-read", [
      claudeLine({
        type: "user",
        isMeta: true,
        sessionId: "meta-sync-session",
        cwd: "/tmp/meta-sync-cwd",
        timestamp: "1999-01-01T00:00:00.000Z",
        message: { content: "meta sync text must not leak" },
      }),
      claudeLine({
        type: "user",
        sessionId: "accepted-sync-session",
        cwd: "/tmp/accepted-sync-cwd",
        timestamp: "2026-06-05T00:00:00.000Z",
        message: { content: "private claude sync needle" },
      }),
      claudeLine({
        type: "assistant",
        sessionId: "accepted-sync-session",
        cwd: "/tmp/accepted-sync-cwd",
        timestamp: "2026-06-05T00:00:01.000Z",
        message: { content: [{ type: "text", text: "private claude sync answer" }] },
      }),
    ]);
    const dbPath = join(root, "index.sqlite");

    const summary = await syncSessions({
      dbPath,
      sourceId: "claude-code",
      selector: { source: "claude-code", kind: "all", root },
    });

    expect(summary.errors).toBe(0);
    expect(summary.added).toBe(1);
    expect(summary.coverage.written).toBe(true);
    expect(summary.coverage.selector).toEqual({ source: "claude-code", kind: "all", root });
    expect(summary.coverage.sourceFileCount).toBe(1);
    expect(summary.coverage.indexedSessionCount).toBe(1);

    const foundClaude = findSessions(
      dbPath,
      "private claude sync needle",
      10,
      { source: "claude-code", kind: "all", root },
      { sourceId: "claude-code" },
    );
    expect(foundClaude.results.map((result) => result.sessionUuid)).toEqual(["claude-code:accepted-sync-session"]);
    expect(JSON.stringify(foundClaude.results)).not.toContain("meta sync text must not leak");

    const foundCodexDefault = findSessions(dbPath, "private claude sync needle", 10);
    expect(foundCodexDefault.results).toEqual([]);

    const page = getMessagePage(dbPath, "claude-code:accepted-sync-session", 0, 10);
    expect(page.session.sourceId).toBe("claude-code");
    expect(page.session.nativeSessionId).toBe("accepted-sync-session");
    expect(page.session.cwd).toBe("/tmp/accepted-sync-cwd");
    expect(page.messages.map((message) => message.contentText)).toEqual([
      "private claude sync needle",
      "private claude sync answer",
    ]);
    expect(JSON.stringify(page)).not.toContain("meta-sync-session");
    expect(JSON.stringify(page)).not.toContain("/tmp/meta-sync-cwd");
    expect(JSON.stringify(page)).not.toContain("1999-01-01");
    expect(JSON.stringify(page)).not.toContain("meta sync text must not leak");
  });

  test("fallback session ids stay unique when different directories share the same file name", async () => {
    const { root } = writeClaudeFixtureTree("fallback-session-id", [
      {
        relativePath: "projects/alpha/conversation.jsonl",
        lines: [
          claudeLine({
            type: "user",
            cwd: "/tmp/alpha-cwd",
            timestamp: "2026-06-05T00:00:00.000Z",
            message: { content: "alpha fallback needle" },
          }),
          claudeLine({
            type: "assistant",
            cwd: "/tmp/alpha-cwd",
            timestamp: "2026-06-05T00:00:01.000Z",
            message: { content: "alpha fallback answer" },
          }),
        ],
      },
      {
        relativePath: "projects/beta/conversation.jsonl",
        lines: [
          claudeLine({
            type: "user",
            cwd: "/tmp/beta-cwd",
            timestamp: "2026-06-05T00:00:02.000Z",
            message: { content: "beta fallback needle" },
          }),
          claudeLine({
            type: "assistant",
            cwd: "/tmp/beta-cwd",
            timestamp: "2026-06-05T00:00:03.000Z",
            message: { content: "beta fallback answer" },
          }),
        ],
      },
    ]);
    const dbPath = join(root, "index.sqlite");

    const summary = await syncSessions({
      dbPath,
      sourceId: "claude-code",
      selector: { source: "claude-code", kind: "all", root },
    });

    expect(summary.added).toBe(2);
    expect(summary.coverage.indexedSessionCount).toBe(2);

    const foundAlpha = findSessions(
      dbPath,
      "alpha fallback needle",
      10,
      { source: "claude-code", kind: "all", root },
      { sourceId: "claude-code" },
    );
    const foundBeta = findSessions(
      dbPath,
      "beta fallback needle",
      10,
      { source: "claude-code", kind: "all", root },
      { sourceId: "claude-code" },
    );

    expect(foundAlpha.results).toHaveLength(1);
    expect(foundBeta.results).toHaveLength(1);
    expect(foundAlpha.results[0]?.sessionUuid).not.toBe(foundBeta.results[0]?.sessionUuid);
  });

  test("keeps current-main Codex adapter as the only public adapter", () => {
    expect(getSessionSourceAdapter().id).toBe("codex");
    expect(listSessionSourceAdapters().filter((adapter) => adapter.public).map((adapter) => adapter.id)).toEqual(["codex"]);
  });
});

function writeClaudeFixture(name: string, lines: string[]): { root: string; filePath: string } {
  const base = mkdtempSync(join(tmpdir(), `cxs-claude-${name}-`));
  tempDirs.push(base);
  const root = join(base, "projects", "synthetic-project");
  mkdirSync(root, { recursive: true });
  const filePath = join(root, `${name}.jsonl`);
  writeFileSync(filePath, `${lines.join("\n")}\n`);
  return { root: resolve(root), filePath };
}

function writeClaudeFixtureTree(
  name: string,
  files: Array<{ relativePath: string; lines: string[] }>,
): { root: string } {
  const base = mkdtempSync(join(tmpdir(), `cxs-claude-tree-${name}-`));
  tempDirs.push(base);
  const root = resolve(base);

  for (const file of files) {
    const filePath = join(root, file.relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${file.lines.join("\n")}\n`);
  }

  return { root };
}

function claudeLine(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}
