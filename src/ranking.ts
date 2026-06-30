import { DEFAULT_SESSION_SOURCE_ID, type FindMatchRole, type FindResult, type MatchSource, type SessionSourceId } from "./types";
import { queryTerms, tokenize } from "./tokenize";

export interface RawHitRow {
  sourceId?: SessionSourceId;
  sessionKey?: string;
  sessionUuid: string;
  title: string;
  summaryText: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  matchSource: MatchSource;
  matchSeq: number | null;
  matchRole: FindMatchRole;
  matchTimestamp: string | null;
  contentText: string;
  snippet: string;
  // FTS path: negative bm25(). LIKE path: a small negative ordinal. Either
  // way, lower is "better" from the SQL side; we flip the sign during
  // rerank so all bonuses stay positive and additive.
  score: number;
}

export interface QuerySignals {
  normalizedQuery: string;
  terms: string[];
  isMultiTerm: boolean;
  isPathLikeCommand: boolean;
}

export function buildQuerySignals(query: string): QuerySignals {
  const normalizedQuery = query.trim().toLowerCase();
  const terms = queryTerms(query);

  // OPTIMIZATION: Testing regex against a trimmed string avoids intermediate
  // array allocations from `split()` and `filter()`. It's ~10x faster.
  const trimmed = query.trim();
  const hasMultipleRawTokens = trimmed.length > 0 && /\s/.test(trimmed);
  const hasPathLikeToken = /[\\/._:-]/.test(query);

  return {
    normalizedQuery,
    terms,
    isMultiTerm: hasMultipleRawTokens,
    isPathLikeCommand: hasMultipleRawTokens && hasPathLikeToken,
  };
}

interface SessionAggregate {
  row: RawHitRow;
  bestRow: RawHitRow;
  bestDisplayRow: RawHitRow;
  bestRowSignalScore: number;
  bestDisplayRowSignalScore: number;
  hitCount: number;
  sessionHitCount: number;
  userHitCount: number;
  titlePhrase: boolean;
  titleTermHits: number;
  cwdTermHits: number;
}

export function rerankHits(rows: RawHitRow[], query: string, limit: number): FindResult[] {
  const signals = buildQuerySignals(query);
  const grouped = aggregateRows(rows, signals);
  return rankAggregates(grouped, limit);
}

function aggregateRows(rows: RawHitRow[], signals: QuerySignals): Map<string, SessionAggregate> {
  const grouped = new Map<string, SessionAggregate>();

  for (const row of rows) {
    const signalScore = scoreRow(row, signals);
    const key = row.sessionKey ?? row.sessionUuid;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, createSessionAggregate(row, signals, signalScore));
    } else {
      updateSessionAggregate(existing, row, signalScore);
    }
  }

  return grouped;
}

function createSessionAggregate(row: RawHitRow, signals: QuerySignals, signalScore: number): SessionAggregate {
  // OPTIMIZATION: title and cwd are identical for all rows of the same session.
  // Computing them only once per sessionUuid avoids redundant string allocations,
  // .toLowerCase() conversions, and .includes() term matching overhead.
  const rowTitleLower = row.title.toLowerCase();
  const rowCwdLower = row.cwd.toLowerCase();
  const titlePhrase = signals.normalizedQuery.length > 0
    && (signals.isPathLikeCommand
      ? containsBoundedPhrase(rowTitleLower, signals.normalizedQuery)
      : rowTitleLower.includes(signals.normalizedQuery));
  const titleTermHits = countMatchedTerms(rowTitleLower, signals.terms);
  const cwdTermHits = countMatchedTerms(rowCwdLower, signals.terms);

  return {
    row,
    bestRow: row,
    bestDisplayRow: row,
    bestRowSignalScore: signalScore,
    bestDisplayRowSignalScore: signalScore,
    hitCount: 1,
    sessionHitCount: row.matchSource === "session" ? 1 : 0,
    userHitCount: row.matchRole === "user" ? 1 : 0,
    titlePhrase,
    titleTermHits,
    cwdTermHits,
  };
}

function updateSessionAggregate(existing: SessionAggregate, row: RawHitRow, signalScore: number): void {
  existing.hitCount += 1;
  if (row.matchSource === "session") existing.sessionHitCount += 1;
  if (row.matchRole === "user") existing.userHitCount += 1;
  // titlePhrase, titleTermHits, and cwdTermHits are session-level constants,
  // so we don't need to update them for subsequent rows of the same session.
  if (signalScore > existing.bestRowSignalScore) {
    existing.bestRow = row;
    existing.bestRowSignalScore = signalScore;
  }
  if (shouldUseDisplayRow(existing.bestDisplayRow, row, existing.bestDisplayRowSignalScore, signalScore)) {
    existing.bestDisplayRow = row;
    existing.bestDisplayRowSignalScore = signalScore;
  }
}

function rankAggregates(grouped: Map<string, SessionAggregate>, limit: number): FindResult[] {
  const now = Date.now();
  const ranked = Array.from(grouped.values())
    .map((aggregate) => ({
      aggregate,
      sessionScore: scoreSession(aggregate, now),
    }))
    .sort((left, right) => {
      if (right.sessionScore !== left.sessionScore) {
        return right.sessionScore - left.sessionScore;
      }
      // OPTIMIZATION: Lexicographical comparison of ISO 8601 strings is ~40x faster than Date.parse
      const rEnded = right.aggregate.row.endedAt;
      const lEnded = left.aggregate.row.endedAt;
      if (rEnded > lEnded) return 1;
      if (rEnded < lEnded) return -1;
      return 0;
    });

  return ranked.slice(0, limit).map(({ aggregate, sessionScore }, index) => {
    const sourceId = aggregate.row.sourceId ?? DEFAULT_SESSION_SOURCE_ID;
    return {
      rank: index + 1,
      sourceId,
      sessionUuid: aggregate.row.sessionUuid,
      sessionRef: sessionRefForResult(sourceId, aggregate.row.sessionUuid, aggregate.row.sessionKey),
      title: aggregate.row.title,
      summaryText: aggregate.row.summaryText,
      cwd: aggregate.row.cwd,
      startedAt: aggregate.row.startedAt,
      endedAt: aggregate.row.endedAt,
      matchCount: aggregate.hitCount,
      matchSource: aggregate.bestDisplayRow.matchSource,
      matchSeq: aggregate.bestDisplayRow.matchSeq,
      matchRole: aggregate.bestDisplayRow.matchRole,
      matchTimestamp: aggregate.bestDisplayRow.matchTimestamp,
      score: sessionScore,
      snippet: aggregate.bestDisplayRow.snippet,
    };
  });
}

function sessionRefForResult(sourceId: SessionSourceId, sessionUuid: string, sessionKey?: string): string {
  if (sourceId === DEFAULT_SESSION_SOURCE_ID) return sessionUuid;
  return sessionKey ?? `${sourceId}:${sessionUuid}`;
}

function shouldUseDisplayRow(
  current: RawHitRow,
  candidate: RawHitRow,
  currentScore: number,
  candidateScore: number,
): boolean {
  if (candidate.matchSource === "message" && current.matchSource !== "message") return true;
  if (candidate.matchSource !== current.matchSource) return false;
  return candidateScore > currentScore;
}

/**
 * Score a single FTS/LIKE row. Higher is better. The only signals we trust
 * at row-level are:
 * 1. The normalized FTS bm25 score (flipped so higher=better).
 * 2. Whether the full query phrase appears verbatim in the content.
 * 3. User-message bump (user-authored content is usually the search intent).
 */
function scoreRow(row: RawHitRow, signals: QuerySignals): number {
  const normalizedBm25 = -row.score; // higher is better now
  const contentLower = row.contentText.toLowerCase();
  const contentPhrase = signals.normalizedQuery.length > 0
    && (signals.isPathLikeCommand
      ? containsBoundedPhrase(contentLower, signals.normalizedQuery)
      : contentLower.includes(signals.normalizedQuery));
  const termCoverage = countMatchedTerms(contentLower, signals.terms);
  const commandSequenceBonus = scorePathLikeCommandSequence(contentLower, signals);

  return normalizedBm25
    + (contentPhrase ? 8 : 0)
    + commandSequenceBonus
    + termCoverage * 2
    + (row.matchSource === "message" ? 4 : 0)
    + (row.matchRole === "user" ? 2 : 0);
}

/**
 * Score a whole session. Combines the best row's signal score with session
 * metadata signals (title, cwd, user-authored evidence, recency) so that a
 * session whose raw FTS match is weaker but whose title/cwd strongly reflect
 * the query can still win.
 */
function scoreSession(aggregate: SessionAggregate, now: number): number {
  const recencyBonus = recencyDecay(aggregate.row.endedAt, now);

  return aggregate.bestRowSignalScore
    + (aggregate.titlePhrase ? 30 : 0)
    + aggregate.titleTermHits * 10
    + aggregate.cwdTermHits * 18
    + Math.min(aggregate.userHitCount, 3) * 4
    + Math.min(aggregate.sessionHitCount, 2) * 2
    + Math.min(aggregate.hitCount, 6) * 1.5
    + recencyBonus;
}

/**
 * Linear decay over a 120-day window. Anything older contributes nothing.
 * The 0.15-per-day factor means today's session gets +18, yesterday +17.85,
 * a month ago +13.5, which is meaningful against title-boost scale but does
 * not dominate genuine content matches.
 */
function recencyDecay(endedAt: string, now: number): number {
  const ts = Date.parse(endedAt);
  if (Number.isNaN(ts)) return 0;
  const days = Math.max(0, (now - ts) / (1000 * 60 * 60 * 24));
  return Math.max(0, 18 - days * 0.15);
}

function countMatchedTerms(haystack: string, terms: string[]): number {
  let matched = 0;
  for (const term of terms) {
    if (haystack.includes(term)) matched += 1;
  }
  return matched;
}

function scorePathLikeCommandSequence(haystack: string, signals: QuerySignals): number {
  if (!signals.isPathLikeCommand || signals.terms.length < 2) return 0;
  if (containsBoundedPhrase(haystack, signals.normalizedQuery)) return 36;

  const span = shortestOrderedSpan(tokenize(haystack), signals.terms);
  if (span === null) return 0;

  const gaps = span - signals.terms.length;
  if (gaps === 0) return 8;
  if (gaps <= 3) return 24 - gaps * 2;
  if (gaps <= signals.terms.length) return 10 - gaps;
  return 0;
}

function shortestOrderedSpan(tokens: string[], terms: string[]): number | null {
  let best = Infinity;

  for (let start = 0; start < tokens.length; start += 1) {
    if (tokens[start] !== terms[0]) continue;

    let termIndex = 1;
    let end = start;
    while (termIndex < terms.length && end + 1 < tokens.length) {
      end += 1;
      if (tokens[end] === terms[termIndex]) termIndex += 1;
    }

    if (termIndex === terms.length) {
      best = Math.min(best, end - start + 1);
    }
  }

  return best === Infinity ? null : best;
}

function containsBoundedPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;

  let offset = 0;
  while (offset < haystack.length) {
    const index = haystack.indexOf(phrase, offset);
    if (index < 0) return false;

    const before = index > 0 ? haystack[index - 1] : undefined;
    const afterIndex = index + phrase.length;
    const after = afterIndex < haystack.length ? haystack[afterIndex] : undefined;
    if (isPhraseBoundary(before) && isPhraseBoundary(after)) return true;
    offset = index + 1;
  }

  return false;
}

function isPhraseBoundary(char: string | undefined): boolean {
  return !char || !/[\p{Letter}\p{Number}_./-]/u.test(char);
}

function getTimestamp(iso: string): number {
  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
