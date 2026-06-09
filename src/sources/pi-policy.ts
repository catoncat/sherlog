export interface PiAcceptedSessionRecord {
  sessionId: string;
  cwd: string;
  timestamp: string;
}

export interface PiAcceptedMessageRecord {
  role: "user" | "assistant";
  contentText: string;
  timestamp: string;
}

export interface PiAcceptedCompactionRecord {
  summaryText: string;
  timestamp: string;
}

export function acceptedPiSessionRecord(record: Record<string, unknown>): PiAcceptedSessionRecord | null {
  if (record.type !== "session") return null;
  const sessionId = typeof record.id === "string" ? record.id.trim() : "";
  const cwd = typeof record.cwd === "string" ? record.cwd.trim() : "";
  const timestamp = timestampFrom(record.timestamp);
  if (!sessionId || !cwd || !timestamp) return null;
  return { sessionId, cwd, timestamp };
}

export function acceptedPiMessageRecord(record: Record<string, unknown>): PiAcceptedMessageRecord | null {
  if (record.type !== "message") return null;
  const message = isRecord(record.message) ? record.message : null;
  if (!message) return null;

  const role = typeof message.role === "string" ? message.role : "";
  if (role !== "user" && role !== "assistant") return null;

  const contentText = textFromContent(message.content).trim();
  if (!contentText) return null;

  return {
    role,
    contentText,
    timestamp: timestampFrom(record.timestamp) || timestampFrom(message.timestamp),
  };
}

export function acceptedPiCompactionRecord(record: Record<string, unknown>): PiAcceptedCompactionRecord | null {
  if (record.type !== "compaction") return null;
  const summaryText = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!summaryText) return null;
  return {
    summaryText,
    timestamp: timestampFrom(record.timestamp),
  };
}

function timestampFrom(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";

  const textBlocks: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) textBlocks.push(text);
      continue;
    }
    if (!isRecord(item)) continue;
    if (item.type !== "text" || typeof item.text !== "string") continue;
    const text = item.text.trim();
    if (text) textBlocks.push(text);
  }
  return textBlocks.join("\n\n");
}

export function timestampDate(timestamp: string): string | null {
  const match = timestamp.match(/^(\d{4}-\d{2}-\d{2})T/);
  return match?.[1] ?? null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
