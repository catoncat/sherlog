import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Selector, SourceFileMeta } from "../types";
import type { SessionSourceAdapter, SourceSnapshotOptions } from "./types";

export const piSourceAdapter: SessionSourceAdapter = {
  id: "pi",
  public: true,
  displayName: "Pi",
  defaultRoot() {
    return resolve(homedir(), ".pi", "agent", "sessions");
  },
  resolveRoot(override?: string) {
    return resolve(override ?? this.defaultRoot());
  },
  async collectFiles(root: string) {
    const { collectPiSourceFiles } = await import("./pi-inventory");
    return collectPiSourceFiles(root);
  },
  async inventoryFromFiles(root: string, files: SourceFileMeta[]) {
    const { piSourceInventoryFromFiles } = await import("./pi-inventory");
    return piSourceInventoryFromFiles(root, files);
  },
  async snapshotFromFiles(selector: Selector, files: SourceFileMeta[]) {
    const { piSourceSnapshotFromFiles } = await import("./pi-inventory");
    return piSourceSnapshotFromFiles(selector, files);
  },
  async collectInventory(root: string) {
    const { collectPiSourceInventory } = await import("./pi-inventory");
    return collectPiSourceInventory(root);
  },
  async collectSnapshot(selector: Selector, options?: SourceSnapshotOptions) {
    const { collectPiSourceSnapshot } = await import("./pi-inventory");
    return collectPiSourceSnapshot(selector, options);
  },
  async parseFile(file: SourceFileMeta) {
    const { parsePiSession } = await import("./pi-parser");
    return parsePiSession(file);
  },
};
