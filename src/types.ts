export type MessageRole = "user" | "assistant";
export type MatchSource = "message" | "session";
export type FindMatchRole = MessageRole | "session";
export type SessionSourceId = "codex" | "claude-code" | "pi";

export const DEFAULT_SESSION_SOURCE_ID: SessionSourceId = "codex";
export const SESSION_SOURCE_IDS = ["codex", "claude-code", "pi"] as const satisfies readonly SessionSourceId[];

export function isSessionSourceId(value: string): value is SessionSourceId {
  return (SESSION_SOURCE_IDS as readonly string[]).includes(value);
}

export interface ParsedMessage {
  role: MessageRole;
  contentText: string;
  timestamp: string;
  seq: number;
  sourceKind: "event_msg";
}

export interface ParsedSession {
  sourceId?: SessionSourceId;
  nativeSessionId?: string;
  sessionKey?: string;
  sessionUuid: string;
  filePath: string;
  title: string;
  summaryText: string;
  compactText: string;
  reasoningSummaryText: string;
  cwd: string;
  model: string;
  startedAt: string;
  endedAt: string;
  messages: ParsedMessage[];
}

export interface SourceReadProof {
  byteCount: number;
  contentFingerprint: string;
  openedMtimeMs: number;
  openedSize: number;
  completedMtimeMs: number;
  completedSize: number;
}

export type ParseSessionResult = (
  | { kind: "parsed"; session: ParsedSession }
  | { kind: "filtered" }
  | { kind: "skipped" }
) & { sourceRead?: SourceReadProof };

export interface SyncErrorDetail {
  filePath: string;
  message: string;
}

export type Selector =
  | { source?: SessionSourceId; kind: "all"; root: string }
  | { source?: SessionSourceId; kind: "date_range"; root: string; fromDate: string; toDate: string }
  | { source?: SessionSourceId; kind: "cwd"; root: string; cwd: string }
  | { source?: SessionSourceId; kind: "cwd_date_range"; root: string; cwd: string; fromDate: string; toDate: string };

export type SelectorKind = Selector["kind"];

export interface DateRange {
  from: string | null;
  to: string | null;
}

export interface SourceInventoryCwdGroup {
  cwd: string;
  fileCount: number;
  pathDateRange: DateRange;
}

export interface SourceInventory {
  root: string;
  totalFiles: number;
  pathDateRange: DateRange;
  cwdGroups: SourceInventoryCwdGroup[];
}

export interface SourceFileMeta {
  filePath: string;
  pathDate: string | null;
  cwd: string;
  mtimeMs: number;
  size: number;
}

export interface SourceSnapshot {
  selector: Selector;
  fingerprint: string;
  fileSetFingerprint: string;
  fileCount: number;
  files: SourceFileMeta[];
}

export interface CoverageRecord {
  id: number;
  selector: Selector;
  sourceFingerprint: string;
  sourceFileSetFingerprint: string;
  sourceFileCount: number;
  indexedSessionCount: number;
  completedAt: string;
  indexVersion: string;
}

export interface CoverageInventoryStatus extends CoverageRecord {
  freshness: "fresh" | "stale";
  staleReason: "none" | "source_content_changed" | "source_set_changed";
  advisory: boolean;
  currentSourceFingerprint: string;
  currentSourceFileSetFingerprint: string;
  currentSourceFileCount: number;
}

export interface CoverageWriteSummary {
  written: boolean;
  selector: Selector;
  sourceFingerprint: string;
  sourceFileSetFingerprint: string;
  sourceFileCount: number;
  indexedSessionCount: number;
  reason?: string;
  staleReason?: "source_content_changed";
  recommendedAction?: "query" | "sync";
}

export interface CoverageStatus {
  requested: Selector | null;
  complete: boolean;
  freshness: "not_checked";
  coveringSelectors: CoverageRecord[];
}

export interface QueryNextAction {
  kind: "check_coverage_then_retry" | "choose_selector_then_check_coverage";
  reason:
    | "zero_results_with_unconfirmed_selector_coverage"
    | "zero_results_without_selector"
    | "stale_or_missing_coverage";
  selector?: Selector;
  steps: string[];
  commands?: Array<{
    label: string;
    recommended: boolean;
    argv: string[];
    selector?: Selector;
  }>;
}

export interface RequestedCoverageStatus {
  requested: Selector;
  complete: boolean;
  freshness: "fresh" | "stale" | "missing";
  staleReason: "none" | "missing" | "source_content_changed" | "source_set_changed";
  sourceFingerprint: string;
  sourceFileSetFingerprint: string;
  sourceFileCount: number;
  coveringSelectors: CoverageInventoryStatus[];
  recommendedAction: "query" | "sync";
}

export interface SessionRecord {
  id: number;
  sourceId: SessionSourceId;
  nativeSessionId: string;
  sessionKey: string;
  sessionUuid: string;
  filePath: string;
  sourceRoot: string;
  title: string;
  summaryText: string;
  cwd: string;
  model: string;
  startedAt: string;
  endedAt: string;
  pathDate: string;
  messageCount: number;
}

export interface MessageRecord {
  sessionUuid: string;
  seq: number;
  role: MessageRole;
  contentText: string;
  timestamp: string;
  sourceKind: string;
}

export interface FindResult {
  rank: number;
  sourceId: SessionSourceId;
  sessionUuid: string;
  sessionRef: string;
  title: string;
  summaryText: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  matchCount: number;
  matchSource: MatchSource;
  matchSeq: number | null;
  matchRole: FindMatchRole;
  matchTimestamp: string | null;
  score: number;
  snippet: string;
}

export interface FindSummary {
  query: string;
  sourceIds: SessionSourceId[];
  sort: FindSort;
  excludedSessions: string[];
  results: FindResult[];
  // 诚实分母:本次检索覆盖范围(selector 限定后)内的消息总数。用来回述
  // "从 ~N 条历史里定位",分母随搜索范围走,不灌水。
  scannedMessageCount: number;
  coverage: CoverageStatus;
  coverageBySource?: Array<{ sourceId: SessionSourceId; coverage: CoverageStatus }>;
  nextAction?: QueryNextAction;
}

export interface SyncSummary {
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  filtered: number;
  removed: number;
  errors: number;
  errorDetails: SyncErrorDetail[];
  selector: Selector;
  coverage: CoverageWriteSummary;
}

export interface SessionListEntry {
  sessionUuid: string;
  title: string;
  summaryText: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  pathDate: string;
  messageCount: number;
}

export type SessionListSort = "ended" | "started" | "messages";
export type FindSort = "relevance" | "ended" | "started";

export interface SessionListQuery {
  sourceId?: SessionSourceId;
  cwd?: string;
  since?: string;
  selector?: Selector;
  sort: SessionListSort;
  limit: number;
}

export interface SessionListSummary {
  query: SessionListQuery;
  results: SessionListEntry[];
  coverage: CoverageStatus;
  nextAction?: QueryNextAction;
}

export interface CwdCount {
  cwd: string;
  count: number;
}

export interface StatsSummary {
  sessionCount: number;
  messageCount: number;
  earliestStartedAt: string | null;
  latestEndedAt: string | null;
  topCwds: CwdCount[];
  indexVersion: string;
  dbPath: string;
  dbSizeBytes: number;
  lastSyncAt: string | null;
  coverage: CoverageRecord[];
}

export interface StatusSummary {
  context: {
    cwd: string;
    root: string;
    dbPath: string;
    indexVersion: string;
  };
  sourceInventory: SourceInventory;
  index: {
    exists: boolean;
    sessionCount: number;
    messageCount: number;
    earliestStartedAt: string | null;
    latestEndedAt: string | null;
    dbSizeBytes: number;
    lastSyncAt: string | null;
  };
  coverage: CoverageInventoryStatus[];
  requestedCoverage?: RequestedCoverageStatus;
}
