import type { ParseSessionResult, Selector, SourceFileMeta, SourceInventory, SourceSnapshot } from "../types";

export type SessionSourceId = "codex" | "claude-code";

export interface SourceSnapshotOptions {
  strict?: boolean;
  requireCwdMetadata?: boolean;
}

export interface SessionSourceAdapter {
  id: SessionSourceId;
  public: boolean;
  displayName: string;
  defaultRoot(): string;
  resolveRoot(override?: string): string;
  collectInventory(root: string): Promise<SourceInventory>;
  collectSnapshot(selector: Selector, options?: SourceSnapshotOptions): Promise<SourceSnapshot>;
  parseFile(file: SourceFileMeta): Promise<ParseSessionResult>;
}
