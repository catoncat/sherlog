import { coverageEntriesForSession, getMessagesForPage, getMessagesForRange, getSessionRecord, withSourceAwareReadDb } from "../db";
import { rerankHits } from "../ranking";
import { DEFAULT_SESSION_SOURCE_ID, isSessionSourceId, type FindResult, type SessionRecord, type SessionSourceId } from "../types";
import type { Db } from "../db";
import { searchMessageHits } from "./search";

export class SessionNotFoundError extends Error {
  sessionRef: string;
  sourceId: SessionSourceId;
  nativeSessionId: string;

  constructor(sessionRef: string) {
    const identity = parseSessionRef(sessionRef);
    super(`session not found in Sherlog index: ${sessionRef}`);
    this.name = "SessionNotFoundError";
    this.sessionRef = sessionRef;
    this.sourceId = identity.sourceId;
    this.nativeSessionId = identity.nativeSessionId;
  }
}

export function getMessageRange(
  dbPath: string,
  sessionUuid: string,
  options: { seq?: number; query?: string; before: number; after: number },
): {
  session: SessionRecord;
  anchorSeq: number;
  rangeStartSeq: number;
  rangeEndSeq: number;
  messages: ReturnType<typeof getMessagesForRange>;
  coverage: { entries: ReturnType<typeof coverageEntriesForSession> };
} {
  return withSourceAwareReadDb(dbPath, (db) => {
    const session = getSessionRecord(db, sessionUuid);
    if (!session) throw new SessionNotFoundError(sessionUuid);
    const anchorSeq = resolveAnchorSeq(db, session, options.seq, options.query);

    const rangeStartSeq = Math.max(0, anchorSeq - options.before);
    const rangeEndSeq = anchorSeq + options.after;
    const messages = getMessagesForRange(db, session.id, rangeStartSeq, rangeEndSeq);
    return {
      session,
      anchorSeq,
      rangeStartSeq,
      rangeEndSeq,
      messages,
      coverage: { entries: coverageEntriesForSession(db, session) },
    };
  });
}

export function getMessagePage(
  dbPath: string,
  sessionUuid: string,
  offset: number,
  limit: number,
): {
  session: SessionRecord;
  offset: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
  messages: ReturnType<typeof getMessagesForPage>;
  coverage: { entries: ReturnType<typeof coverageEntriesForSession> };
} {
  return withSourceAwareReadDb(dbPath, (db) => {
    const session = getSessionRecord(db, sessionUuid);
    if (!session) throw new SessionNotFoundError(sessionUuid);
    const messages = getMessagesForPage(db, session.id, offset, limit);
    const totalCount = session.messageCount;
    const hasMore = offset + messages.length < totalCount;
    return {
      session,
      offset,
      limit,
      totalCount,
      hasMore,
      messages,
      coverage: { entries: coverageEntriesForSession(db, session) },
    };
  });
}

function resolveAnchorSeq(
  db: Db,
  session: SessionRecord,
  seq?: number,
  query?: string,
): number {
  if (typeof seq === "number") {
    return seq;
  }

  if (query) {
    const best = searchTopHitInSession(db, session, query);
    if (best && typeof best.matchSeq === "number") return best.matchSeq;
    // Query found no message-level hit (e.g. session-level match from title or
    // compact). Fall back to seq=0 so read-range still returns a usable window
    // instead of throwing — the caller can page forward if needed.
    return 0;
  }

  throw new Error("read-range requires explicit session_uuid plus either --seq or --query");
}

function searchTopHitInSession(db: Db, session: SessionRecord, query: string): FindResult | null {
  const rows = searchMessageHits(db, query, 20, session.id, null, { sourceId: session.sourceId });
  const result = rerankHits(rows, query, 1)[0];
  return result ?? null;
}

function parseSessionRef(sessionRef: string): { sourceId: SessionSourceId; nativeSessionId: string } {
  const separator = sessionRef.indexOf(":");
  if (separator > 0) {
    const sourceId = sessionRef.slice(0, separator);
    const nativeSessionId = sessionRef.slice(separator + 1);
    if (isSessionSourceId(sourceId)) return { sourceId, nativeSessionId };
  }
  return { sourceId: DEFAULT_SESSION_SOURCE_ID, nativeSessionId: sessionRef };
}
