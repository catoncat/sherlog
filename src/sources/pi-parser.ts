import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import type { ParsedMessage, ParseSessionResult, SourceFileMeta } from "../types";
import { acceptedPiCompactionRecord, acceptedPiMessageRecord, acceptedPiSessionRecord, isRecord } from "./pi-policy";

interface ParseState {
  messages: ParsedMessage[];
  compactionSummaries: string[];
  compactionTimestamps: string[];
  sessionId: string;
  cwd: string;
  model: string;
  sessionTimestamp: string;
}

export async function parsePiSession(file: SourceFileMeta): Promise<ParseSessionResult> {
  const state: ParseState = {
    messages: [],
    compactionSummaries: [],
    compactionTimestamps: [],
    sessionId: "",
    cwd: "",
    model: "",
    sessionTimestamp: "",
  };

  const lineReader = createInterface({
    input: createReadStream(file.filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lineReader) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    processRecord(record, state);
  }

  const compactText = buildCompactText(state.compactionSummaries);
  if (state.messages.length === 0 && !compactText) return { kind: "skipped" };

  const nativeSessionId = state.sessionId || fallbackSessionId(file);
  const sessionKey = `pi:${nativeSessionId}`;
  const title = firstUserMessage(state.messages) ?? firstCompactionTitle(state.compactionSummaries) ?? "(no title)";
  const { startedAt, endedAt } = sessionTimeRange(state, file);

  return {
    kind: "parsed",
    session: {
      sourceId: "pi",
      nativeSessionId,
      sessionKey,
      sessionUuid: sessionKey,
      filePath: file.filePath,
      title,
      summaryText: buildSessionSummary(state.messages),
      compactText,
      reasoningSummaryText: "",
      cwd: state.cwd || file.cwd,
      model: state.model,
      startedAt,
      endedAt,
      messages: state.messages,
    },
  };
}

function processRecord(record: Record<string, unknown>, state: ParseState): void {
  const session = acceptedPiSessionRecord(record);
  if (session) {
    if (!state.sessionId && session.sessionId) state.sessionId = session.sessionId;
    if (!state.cwd && session.cwd) state.cwd = session.cwd;
    if (!state.sessionTimestamp && session.timestamp) state.sessionTimestamp = session.timestamp;
    return;
  }

  if (record.type === "model_change" && typeof record.modelId === "string" && !state.model) {
    state.model = record.modelId;
    return;
  }

  const compaction = acceptedPiCompactionRecord(record);
  if (compaction) {
    state.compactionSummaries.push(compaction.summaryText);
    if (compaction.timestamp) state.compactionTimestamps.push(compaction.timestamp);
    return;
  }

  const message = acceptedPiMessageRecord(record);
  if (!message) return;

  state.messages.push({
    role: message.role,
    contentText: message.contentText,
    timestamp: message.timestamp,
    seq: state.messages.length,
    sourceKind: "event_msg",
  });
}

function sessionTimeRange(state: ParseState, file: SourceFileMeta): { startedAt: string; endedAt: string } {
  let startedAt: string | null = state.sessionTimestamp || null;
  let endedAt: string | null = state.sessionTimestamp || null;
  for (const timestamp of [...state.compactionTimestamps, ...state.messages.map((message) => message.timestamp)]) {
    if (!timestamp) continue;
    if (!startedAt || timestamp < startedAt) startedAt = timestamp;
    if (!endedAt || timestamp > endedAt) endedAt = timestamp;
  }

  const fallback = file.pathDate ? `${file.pathDate}T00:00:00.000Z` : new Date(file.mtimeMs || 0).toISOString();
  return {
    startedAt: startedAt ?? fallback,
    endedAt: endedAt ?? startedAt ?? fallback,
  };
}

function firstUserMessage(messages: ParsedMessage[]): string | null {
  const first = messages.find((message) => message.role === "user");
  if (!first) return null;
  return first.contentText.slice(0, 120);
}

function buildSessionSummary(messages: ParsedMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  const firstAssistant = messages.find((message) => message.role === "assistant");
  let latestUser: ParsedMessage | undefined;
  let latestAssistant: ParsedMessage | undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!latestUser && message.role === "user") latestUser = message;
    if (!latestAssistant && message.role === "assistant") latestAssistant = message;
    if (latestUser && latestAssistant) break;
  }

  const parts = [
    firstUser ? `user: ${normalizeSummaryText(firstUser.contentText.slice(0, 5000))}` : "",
    firstAssistant ? `assistant: ${normalizeSummaryText(firstAssistant.contentText.slice(0, 5000))}` : "",
    latestUser && latestUser.seq !== firstUser?.seq ? `follow-up: ${normalizeSummaryText(latestUser.contentText.slice(0, 5000))}` : "",
    latestAssistant && latestAssistant.seq !== firstAssistant?.seq ? `latest: ${normalizeSummaryText(latestAssistant.contentText.slice(0, 5000))}` : "",
  ].filter(Boolean);

  return parts.join(" | ").slice(0, 480);
}

function buildCompactText(summaries: string[]): string {
  return summaries.map(normalizeSummaryText).filter(Boolean).join("\n\n").slice(0, 20000);
}

function firstCompactionTitle(summaries: string[]): string | null {
  const first = summaries.find((summary) => summary.trim());
  if (!first) return null;
  const normalized = normalizeSummaryText(first).slice(0, 120);
  return normalized || null;
}

function fallbackSessionId(file: SourceFileMeta): string {
  const fileName = basename(file.filePath).replace(/\.jsonl$/i, "");
  const pathDigest = createHash("sha256").update(file.filePath).digest("hex");
  if (fileName) return `${fileName}-${pathDigest}`;
  return pathDigest;
}

function normalizeSummaryText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export { isRecord };
