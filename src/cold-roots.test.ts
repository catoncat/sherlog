import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addColdRoot,
  coldRootsPathForDb,
  listColdPresentNativeSessionIds,
  listColdRootPaths,
  nativeSessionIdFromColdPath,
  removeColdRoot,
} from "./cold-roots";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("cold-roots", () => {
  test("parses Codex rollout uuid from plain and zst paths", () => {
    const id = "019ddf91-0a97-7863-86c7-194dbe02386f";
    expect(
      nativeSessionIdFromColdPath(
        `/tmp/archived/2026/05/01/rollout-2026-05-01T02-05-17-${id}.jsonl`,
      ),
    ).toBe(id);
    expect(
      nativeSessionIdFromColdPath(
        `/tmp/archived/2026/05/01/rollout-2026-05-01T02-05-17-${id}.jsonl.zst`,
      ),
    ).toBe(id);
    expect(nativeSessionIdFromColdPath("/tmp/archived/note.txt")).toBeNull();
  });

  test("registers cold roots next to the index db and lists presence including zst", () => {
    const base = mkdtempSync(join(tmpdir(), "cxs-cold-roots-"));
    tempDirs.push(base);
    const dbPath = join(base, "state", "index.sqlite");
    const coldRoot = join(base, "archived_sessions");
    const day = join(coldRoot, "2026", "05", "01");
    mkdirSync(day, { recursive: true });
    const coldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const missingName = "rollout-2026-05-01T10-00-00-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl.zst";
    writeFileSync(join(day, `rollout-2026-05-01T09-00-00-${coldId}.jsonl.zst`), "fake-zst");
    writeFileSync(join(day, missingName), "fake-zst");

    const configPath = coldRootsPathForDb(dbPath);
    const entry = addColdRoot(configPath, coldRoot, "codex");
    expect(entry.root).toBe(coldRoot);
    expect(listColdRootPaths(configPath, "codex")).toEqual([coldRoot]);

    const present = listColdPresentNativeSessionIds([coldRoot]);
    expect(present.has(coldId)).toBe(true);
    expect(present.has("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBe(true);

    expect(removeColdRoot(configPath, coldRoot, "codex")).toBe(true);
    expect(listColdRootPaths(configPath, "codex")).toEqual([]);
  });
});
