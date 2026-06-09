import { claudeCodeSourceAdapter } from "./claude-code";
import { codexSourceAdapter } from "./codex";
import { piSourceAdapter } from "./pi";
import type { SessionSourceAdapter, SessionSourceId } from "./types";

const adapters = new Map<SessionSourceId, SessionSourceAdapter>([
  [codexSourceAdapter.id, codexSourceAdapter],
  [claudeCodeSourceAdapter.id, claudeCodeSourceAdapter],
  [piSourceAdapter.id, piSourceAdapter],
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
