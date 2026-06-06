export interface ClaudeAcceptedRecord {
  role: "user" | "assistant";
  contentText: string;
  timestamp: string;
  sessionId: string;
  cwd: string;
}

export function acceptedClaudeRecord(record: Record<string, unknown>): ClaudeAcceptedRecord | null {
  if (record.isMeta === true || record.isSidechain === true) return null;

  const type = typeof record.type === "string" ? record.type : "";
  if (type !== "user" && type !== "assistant") return null;

  const contentText = extractText(record).trim();
  if (!contentText) return null;

  return {
    role: type,
    contentText,
    timestamp: typeof record.timestamp === "string" && record.timestamp.trim() ? record.timestamp.trim() : "",
    sessionId: typeof record.sessionId === "string" ? record.sessionId : "",
    cwd: typeof record.cwd === "string" ? record.cwd : "",
  };
}

function extractText(record: Record<string, unknown>): string {
  const direct = textFromContent(record.content);
  if (direct) return direct;
  const message = isRecord(record.message) ? record.message : null;
  if (!message) return "";
  return textFromContent(message.content);
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";

  const textBlocks: string[] = [];
  for (const item of value) {
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
