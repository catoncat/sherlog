import { codexSourceAdapter } from "./codex";
import type { SessionSourceAdapter, SessionSourceId } from "./types";

const adapters = new Map<SessionSourceId, SessionSourceAdapter>([
  [codexSourceAdapter.id, codexSourceAdapter],
]);

export function getSessionSourceAdapter(sourceId: SessionSourceId = "codex"): SessionSourceAdapter {
  const adapter = adapters.get(sourceId);
  if (!adapter) {
    throw new Error(`Unsupported session source: ${sourceId}`);
  }
  return adapter;
}

export function listSessionSourceAdapters(): SessionSourceAdapter[] {
  return [...adapters.values()];
}
