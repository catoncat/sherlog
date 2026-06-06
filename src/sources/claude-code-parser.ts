import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import type { ParsedMessage, ParseSessionResult, SourceFileMeta } from "../types";
import { acceptedClaudeRecord, isRecord } from "./claude-code-policy";

interface ParseState {
  messages: ParsedMessage[];
  sessionId: string;
  cwd: string;
}

export async function parseClaudeCodeSession(file: SourceFileMeta): Promise<ParseSessionResult> {
  const state: ParseState = {
    messages: [],
    sessionId: "",
    cwd: "",
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

  if (state.messages.length === 0) return { kind: "skipped" };

  const nativeSessionId = state.sessionId || fallbackSessionId(file);
  const sessionKey = `claude-code:${nativeSessionId}`;
  const title = firstUserMessage(state.messages) ?? "(no title)";
  const { startedAt, endedAt } = sessionTimeRange(state.messages, file);

  return {
    kind: "parsed",
    session: {
      sourceId: "claude-code",
      nativeSessionId,
      sessionKey,
      sessionUuid: sessionKey,
      filePath: file.filePath,
      title,
      summaryText: buildSessionSummary(state.messages),
      compactText: "",
      reasoningSummaryText: "",
      cwd: state.cwd || file.cwd,
      model: "",
      startedAt,
      endedAt,
      messages: state.messages,
    },
  };
}

function processRecord(record: Record<string, unknown>, state: ParseState): void {
  const accepted = acceptedClaudeRecord(record);
  if (!accepted) return;

  if (!state.sessionId && accepted.sessionId) state.sessionId = accepted.sessionId;
  if (!state.cwd && accepted.cwd) state.cwd = accepted.cwd;

  state.messages.push({
    role: accepted.role,
    contentText: accepted.contentText,
    timestamp: accepted.timestamp,
    seq: state.messages.length,
    sourceKind: "event_msg",
  });
}

function sessionTimeRange(messages: ParsedMessage[], file: SourceFileMeta): { startedAt: string; endedAt: string } {
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  for (const message of messages) {
    if (!message.timestamp) continue;
    if (!startedAt || message.timestamp < startedAt) startedAt = message.timestamp;
    if (!endedAt || message.timestamp > endedAt) endedAt = message.timestamp;
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

function fallbackSessionId(file: SourceFileMeta): string {
  const fileName = basename(file.filePath).replace(/\.jsonl$/i, "");
  if (fileName) return fileName;
  return createHash("sha256").update(file.filePath).digest("hex").slice(0, 16);
}

function normalizeSummaryText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export { isRecord };
