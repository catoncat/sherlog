import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
    expect(listSessionSourceAdapters().map((adapter) => adapter.id)).toEqual(["codex"]);
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
});

function line(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: new Date("2026-04-22T00:00:00.000Z").toISOString(),
    type,
    payload,
  });
}
