import { INDEX_VERSION, isCurrentIndexVersion } from "../env";
import { canonicalizeSelector, selectorImplies, selectorSource, selectorStorageKey } from "../selector";
import { DEFAULT_SESSION_SOURCE_ID, type CoverageRecord, type Selector, type SessionRecord, type SessionSourceId } from "../types";
import { deleteSessionById } from "./session-store";
import type { Db } from "./shared";
import { selectorWhereSql, sessionRootFromFile, tableExists } from "./sql";

export function replaceCoverage(
  db: Db,
  selector: Selector,
  sourceFingerprint: string,
  sourceFileSetFingerprint: string,
  sourceFileCount: number,
  indexedSessionCount: number,
  indexVersion: string,
): CoverageRecord {
  const canonical = canonicalizeSelector(selector);
  const key = selectorStorageKey(canonical);
  const stmt = db.prepare(`
    INSERT INTO coverage (
      source_id, selector_key, selector_json, selector_kind, root, cwd, from_date, to_date,
      source_fingerprint, source_file_set_fingerprint, source_file_count, indexed_session_count, index_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(selector_key) DO UPDATE SET
      source_id = excluded.source_id,
      selector_json = excluded.selector_json,
      selector_kind = excluded.selector_kind,
      root = excluded.root,
      cwd = excluded.cwd,
      from_date = excluded.from_date,
      to_date = excluded.to_date,
      source_fingerprint = excluded.source_fingerprint,
      source_file_set_fingerprint = excluded.source_file_set_fingerprint,
      source_file_count = excluded.source_file_count,
      indexed_session_count = excluded.indexed_session_count,
      completed_at = CURRENT_TIMESTAMP,
      index_version = excluded.index_version
  `);
  stmt.run(
    selectorSource(canonical),
    key,
    JSON.stringify(canonical),
    canonical.kind,
    canonical.root,
    "cwd" in canonical ? canonical.cwd : null,
    "fromDate" in canonical ? canonical.fromDate : null,
    "toDate" in canonical ? canonical.toDate : null,
    sourceFingerprint,
    sourceFileSetFingerprint,
    sourceFileCount,
    indexedSessionCount,
    indexVersion,
  );
  return getCoverageRecordByKey(db, key)!;
}

export function listCoverageRecords(db: Db, sourceId: SessionSourceId = DEFAULT_SESSION_SOURCE_ID): CoverageRecord[] {
  if (!tableExists(db, "coverage")) return [];
  const rows = db
    .prepare<[SessionSourceId], CoverageRow>("SELECT * FROM coverage WHERE source_id = ? ORDER BY completed_at DESC, id DESC")
    .all(sourceId) as CoverageRow[];
  return rows.map(rowToCoverageRecord);
}

export function coverageStatusForSelector(db: Db, requested: Selector | null): {
  complete: boolean;
  coveringSelectors: CoverageRecord[];
} {
  if (!requested) return { complete: false, coveringSelectors: [] };
  const entries = listCoverageRecords(db, selectorSource(requested)).filter((entry) =>
    isCurrentIndexVersion(entry.indexVersion) && selectorImplies(entry.selector, requested)
  );
  return {
    complete: entries.length > 0,
    coveringSelectors: entries,
  };
}

export function countSessionsForSelector(db: Db, selector: Selector): number {
  const where = selectorWhereSql(selector, "sessions");
  const row = db
    .prepare<typeof where.params, { count: number }>(`
      SELECT COUNT(*) AS count
      FROM sessions
      WHERE ${where.conditions.join(" AND ")}
    `)
    .get(...where.params) as { count: number };
  return row.count;
}

export function deleteSessionsForSelectorExceptFilePaths(
  db: Db,
  selector: Selector,
  retainedFilePaths: Set<string>,
  retainedNativeSessionIds: Set<string> = new Set(),
): { removed: number; retainedCold: number } {
  const where = selectorWhereSql(selector, "sessions");
  const rows = db
    .prepare<typeof where.params, { id: number; filePath: string; nativeSessionId: string }>(`
      SELECT id, file_path AS filePath, native_session_id AS nativeSessionId
      FROM sessions
      WHERE ${where.conditions.join(" AND ")}
    `)
    .all(...where.params) as Array<{ id: number; filePath: string; nativeSessionId: string }>;

  const coldIds = new Set(
    [...retainedNativeSessionIds].map((id) => id.toLowerCase()),
  );
  let removed = 0;
  let retainedCold = 0;
  for (const row of rows) {
    if (retainedFilePaths.has(row.filePath)) continue;
    if (coldIds.has(row.nativeSessionId.toLowerCase())) {
      retainedCold += 1;
      continue;
    }
    deleteSessionById(db, row.id);
    removed += 1;
  }
  return { removed, retainedCold };
}

export function cleanupMismatchedMessagesForSelector(db: Db, selector: Selector): number {
  const where = selectorWhereSql(selector, "s");
  const conditions = [...where.conditions, "m.session_uuid != s.session_uuid"];
  const predicate = conditions.join(" AND ");
  db.prepare<typeof where.params>(`
    DELETE FROM messages_fts
    WHERE rowid IN (
      SELECT m.id
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE ${predicate}
    )
  `).run(...where.params);
  const result = db.prepare<typeof where.params>(`
    DELETE FROM messages
    WHERE id IN (
      SELECT m.id
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE ${predicate}
    )
  `).run(...where.params);
  return Number(result.changes);
}

export function coverageEntriesForSession(db: Db, session: SessionRecord): CoverageRecord[] {
  const root = session.sourceRoot || sessionRootFromFile(session.filePath);
  const sessionSelectors: Selector[] = [
    { source: session.sourceId, kind: "all", root },
    { source: session.sourceId, kind: "cwd", root, cwd: session.cwd },
  ];
  if (session.pathDate) {
    sessionSelectors.push({
      source: session.sourceId,
      kind: "date_range",
      root,
      fromDate: session.pathDate,
      toDate: session.pathDate,
    });
    sessionSelectors.push({
      source: session.sourceId,
      kind: "cwd_date_range",
      root,
      cwd: session.cwd,
      fromDate: session.pathDate,
      toDate: session.pathDate,
    });
  }
  return listCoverageRecords(db, session.sourceId).filter((entry) =>
    sessionSelectors.some((selector) => selectorImplies(entry.selector, selector))
  );
}

type CoverageRow = {
  id: number;
  source_id: string;
  selector_json: string;
  source_fingerprint: string;
  source_file_set_fingerprint: string;
  source_file_count: number;
  indexed_session_count: number;
  completed_at: string;
  index_version: string;
};

function getCoverageRecordByKey(db: Db, key: string): CoverageRecord | null {
  const row = db.prepare<[string], CoverageRow>("SELECT * FROM coverage WHERE selector_key = ? LIMIT 1").get(key);
  return row ? rowToCoverageRecord(row) : null;
}

function rowToCoverageRecord(row: CoverageRow): CoverageRecord {
  return {
    id: row.id,
    selector: JSON.parse(row.selector_json) as Selector,
    sourceFingerprint: row.source_fingerprint,
    sourceFileSetFingerprint: row.source_file_set_fingerprint ?? "",
    sourceFileCount: row.source_file_count,
    indexedSessionCount: row.indexed_session_count,
    completedAt: row.completed_at,
    indexVersion: row.index_version,
  };
}

function requestedIndexVersion(_db: Db): string {
  // Kept as a function so coverage matching has one place for future index
  // compatibility policy; current policy is exact index version equality.
  return INDEX_VERSION;
}
