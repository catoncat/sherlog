import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Selector, SourceFileMeta } from "../types";
import type { SessionSourceAdapter, SourceSnapshotOptions } from "./types";

export const claudeCodeSourceAdapter: SessionSourceAdapter = {
  id: "claude-code",
  public: true,
  displayName: "Claude Code",
  defaultRoot() {
    return resolve(homedir(), ".claude", "projects");
  },
  resolveRoot(override?: string) {
    return resolve(override ?? this.defaultRoot());
  },
  async collectFiles(root: string) {
    const { collectClaudeCodeSourceFiles } = await import("./claude-code-inventory");
    return collectClaudeCodeSourceFiles(root);
  },
  async inventoryFromFiles(root: string, files: SourceFileMeta[]) {
    const { claudeCodeSourceInventoryFromFiles } = await import("./claude-code-inventory");
    return claudeCodeSourceInventoryFromFiles(root, files);
  },
  async snapshotFromFiles(selector: Selector, files: SourceFileMeta[]) {
    const { claudeCodeSourceSnapshotFromFiles } = await import("./claude-code-inventory");
    return claudeCodeSourceSnapshotFromFiles(selector, files);
  },
  async collectInventory(root: string) {
    const { collectClaudeCodeSourceInventory } = await import("./claude-code-inventory");
    return collectClaudeCodeSourceInventory(root);
  },
  async collectSnapshot(selector: Selector, options?: SourceSnapshotOptions) {
    const { collectClaudeCodeSourceSnapshot } = await import("./claude-code-inventory");
    return collectClaudeCodeSourceSnapshot(selector, options);
  },
  async parseFile(file: SourceFileMeta) {
    const { parseClaudeCodeSession } = await import("./claude-code-parser");
    return parseClaudeCodeSession(file);
  },
};
