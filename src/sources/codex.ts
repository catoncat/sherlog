import { DEFAULT_CODEX_DIR, resolveCodexDir } from "../env";
import type { Selector, SourceFileMeta } from "../types";
import { collectCodexSourceInventory, collectCodexSourceSnapshot } from "./codex-inventory";
import { parseCodexSession } from "./codex-parser";
import type { SessionSourceAdapter, SourceSnapshotOptions } from "./types";

export const codexSourceAdapter: SessionSourceAdapter = {
  id: "codex",
  public: true,
  displayName: "Codex",
  defaultRoot() {
    return DEFAULT_CODEX_DIR;
  },
  resolveRoot(override?: string) {
    return resolveCodexDir(override);
  },
  collectInventory(root: string) {
    return collectCodexSourceInventory(root);
  },
  collectSnapshot(selector: Selector, options?: SourceSnapshotOptions) {
    return collectCodexSourceSnapshot(selector, options);
  },
  parseFile(file: SourceFileMeta) {
    return parseCodexSession(file.filePath);
  },
};
