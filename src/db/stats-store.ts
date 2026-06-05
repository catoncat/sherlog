import { DEFAULT_SESSION_SOURCE_ID, type CwdCount, type SessionSourceId } from "../types";
import type { Db } from "./shared";

export function getStatsCounts(db: Db, sourceId: SessionSourceId = DEFAULT_SESSION_SOURCE_ID): {
  sessionCount: number;
  messageCount: number;
  earliestStartedAt: string | null;
  latestEndedAt: string | null;
  lastSyncAt: string | null;
} {
  const row = db
    .prepare<[SessionSourceId]>(`
      SELECT
        COUNT(*) AS sessionCount,
        COALESCE(SUM(message_count), 0) AS messageCount,
        MIN(started_at) AS earliestStartedAt,
        MAX(ended_at) AS latestEndedAt,
        MAX(updated_at) AS lastSyncAt
      FROM sessions
      WHERE source_id = ?
    `)
    .get(sourceId) as {
      sessionCount: number;
      messageCount: number;
      earliestStartedAt: string | null;
      latestEndedAt: string | null;
      lastSyncAt: string | null;
    };
  return row;
}

export function getTopCwds(db: Db, limit: number, sourceId: SessionSourceId = DEFAULT_SESSION_SOURCE_ID): CwdCount[] {
  return db
    .prepare<[SessionSourceId, number], CwdCount>(`
      SELECT cwd, COUNT(*) AS count
      FROM sessions
      WHERE source_id = ? AND cwd != ''
      GROUP BY cwd
      ORDER BY count DESC, cwd ASC
      LIMIT ?
    `)
    .all(sourceId, limit) as CwdCount[];
}
