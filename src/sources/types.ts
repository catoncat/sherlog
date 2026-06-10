import type { ParseSessionResult, Selector, SessionSourceId, SourceFileMeta, SourceInventory, SourceSnapshot } from "../types";

export type { SessionSourceId } from "../types";

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
  collectFiles(root: string): Promise<SourceFileMeta[]>;
  inventoryFromFiles(root: string, files: SourceFileMeta[]): SourceInventory | Promise<SourceInventory>;
  snapshotFromFiles(selector: Selector, files: SourceFileMeta[]): SourceSnapshot | Promise<SourceSnapshot>;
  collectInventory(root: string): Promise<SourceInventory>;
  collectSnapshot(selector: Selector, options?: SourceSnapshotOptions): Promise<SourceSnapshot>;
  parseFile(file: SourceFileMeta): Promise<ParseSessionResult>;
}
