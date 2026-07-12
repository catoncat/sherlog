import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codexSourceAdapter, getSessionSourceAdapter, listSessionSourceAdapters } from ".";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("codex source adapter", () => {
  test("is the registered public default adapter", () => {
    expect(getSessionSourceAdapter()).toBe(codexSourceAdapter);
    expect(getSessionSourceAdapter("codex")).toBe(codexSourceAdapter);
    expect(listSessionSourceAdapters().map((adapter) => adapter.id)).toContain("codex");
    expect(listSessionSourceAdapters().filter((adapter) => adapter.public).map((adapter) => adapter.id)).toEqual([
      "codex",
      "claude-code",
      "pi",
    ]);
    expect(codexSourceAdapter.public).toBe(true);
  });

  test("resolves roots, inventories files, snapshots selectors, and parses Codex files", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-codex-source-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "22");
    mkdirSync(day, { recursive: true });
    const filePath = join(
      day,
      "rollout-2026-04-22T12-00-00-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl",
    );
    writeFileSync(
      filePath,
      [
        line("session_meta", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "/tmp/adapter" }),
        line("turn_context", { model: "gpt-5.4" }),
        line("event_msg", { type: "user_message", message: "adapter session" }),
      ].join("\n"),
    );

    expect(codexSourceAdapter.resolveRoot(root)).toBe(resolve(root));

    const inventory = await codexSourceAdapter.collectInventory(root);
    expect(inventory.totalFiles).toBe(1);
    expect(inventory.cwdGroups[0]?.cwd).toBe("/tmp/adapter");

    const snapshot = await codexSourceAdapter.collectSnapshot({ kind: "cwd", root, cwd: "/tmp/adapter" });
    expect(snapshot.fileCount).toBe(1);
    expect(snapshot.files[0]?.filePath).toBe(filePath);

    const parsed = await codexSourceAdapter.parseFile(snapshot.files[0]);
    expect(parsed.kind).toBe("parsed");
    if (parsed.kind !== "parsed") return;
    expect(parsed.session.sessionUuid).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(parsed.session.messages[0]?.contentText).toBe("adapter session");
  });

  test("filters unsupported, internal, and malformed Codex records from searchable projection", async () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-codex-contract-"));
    tempDirs.push(base);
    const root = join(base, "sessions");
    const day = join(root, "2026", "04", "23");
    mkdirSync(day, { recursive: true });
    const filePath = join(
      day,
      "rollout-2026-04-23T12-00-00-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl",
    );
    writeFileSync(
      filePath,
      [
        "{not json",
        line("session_meta", { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cwd: "/tmp/codex-contract" }),
        line("event_msg", { type: "tool_result", message: "tool result must not leak" }),
        line("event_msg", { type: "user_message", message: "accepted codex user text" }),
        line("event_msg", {
          type: "user_message",
          message: "The following is the Codex agent history whose request action you are assessing\ninternal marker must not leak",
        }),
        line("event_msg", { type: "agent_message", message: "accepted codex assistant text" }),
        line("other_record", { message: "unrelated record must not leak" }),
      ].join("\n"),
    );

    const parsed = await codexSourceAdapter.parseFile({
      filePath,
      cwd: "/tmp/fallback",
      pathDate: "2026-04-23",
      mtimeMs: 0,
      size: statSync(filePath).size,
    });

    expect(parsed.kind).toBe("parsed");
    if (parsed.kind !== "parsed") return;
    expect(parsed.session.messages.map((message) => message.contentText)).toEqual([
      "accepted codex user text",
      "accepted codex assistant text",
    ]);

    const searchableProjection = JSON.stringify(parsed.session);
    expect(searchableProjection).not.toContain("tool result must not leak");
    expect(searchableProjection).not.toContain("internal marker must not leak");
    expect(searchableProjection).not.toContain("unrelated record must not leak");
    expect(searchableProjection).not.toContain("{not json");
  });
});

function line(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: new Date("2026-04-22T00:00:00.000Z").toISOString(),
    type,
    payload,
  });
}
