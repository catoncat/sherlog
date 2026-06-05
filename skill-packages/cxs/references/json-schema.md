# cxs JSON Schema

## find

Top-level shape:

```ts
{
  query: string;
  sort: "relevance" | "ended" | "started";
  excludedSessions: string[];
  results: FindResult[];
  coverage: CoverageStatus;
  nextAction?: QueryNextAction;
}
```

`FindResult`:

```ts
{
  rank: number;
  sessionUuid: string;
  title: string;
  summaryText: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  matchCount: number;
  matchSource: "message" | "session";
  matchSeq: number | null;
  matchRole: "user" | "assistant" | "session";
  matchTimestamp: string | null;
  score: number;
  snippet: string;
}
```

`matchSource = "session"` means the hit came from session-level fields such as title, derived summary, compact handoff, or reasoning summary rather than a concrete message. In that case `matchSeq` is `null`; use `read-page` first instead of fabricating a `read-range --seq` anchor.

`QueryNextAction` appears on `find` / `list` when `results` is empty and the command cannot prove the target coverage is fresh:

```ts
{
  kind: "check_coverage_then_retry" | "choose_selector_then_check_coverage";
  reason: "zero_results_with_unconfirmed_selector_coverage" | "zero_results_without_selector";
  selector?: Selector;
  steps: string[];
}
```

Treat it as a retry gate: choose/check the same selector, run `sync` only if `status.requestedCoverage.recommendedAction === "sync"`, then retry `find` before concluding nothing exists.

## read-range

```ts
{
  session: SessionRecord;
  anchorSeq: number;
  rangeStartSeq: number;
  rangeEndSeq: number;
  messages: MessageRecord[];
  coverage: { entries: CoverageRecord[] };
}
```

## read-page

```ts
{
  session: SessionRecord;
  offset: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
  messages: MessageRecord[];
  coverage: { entries: CoverageRecord[] };
}
```

## list

```ts
{
  query: {
    sourceId?: "codex";
    cwd?: string;
    since?: string;
    selector?: Selector;
    sort: "ended" | "started" | "messages";
    limit: number;
  };
  results: SessionListEntry[];
  coverage: CoverageStatus;
  nextAction?: QueryNextAction;
}
```

## stats

```ts
{
  sessionCount: number;
  messageCount: number;
  earliestStartedAt: string | null;
  latestEndedAt: string | null;
  topCwds: Array<{ cwd: string; count: number }>;
  indexVersion: string;
  dbPath: string;
  dbSizeBytes: number;
  lastSyncAt: string | null;
  coverage: CoverageRecord[];
}
```

## Read Command Errors

`find` / `read-range` / `read-page` / `list` / `stats` return structured
errors in `--json` mode for expected index setup failures:

```ts
{
  error:
    | { code: "index_unavailable"; message: string; dbPath: string; hint: string }
    | { code: "index_schema_upgrade_required"; message: string; dbPath: string; missingColumns: string[]; hint: string };
}
```

## status

```ts
{
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
```

## sync

```ts
{
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  filtered: number;
  removed: number;
  errors: number;
  errorDetails: Array<{
    filePath: string;
    message: string;
  }>;
  selector: Selector;
  coverage: {
    written: boolean;
    selector: Selector;
    sourceFingerprint: string;
    sourceFileCount: number;
    indexedSessionCount: number;
    reason?: string;
  };
}
```

## Shared Records

`SessionRecord`:

```ts
{
  id: number;
  sourceId: "codex";
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
```

`MessageRecord`:

```ts
{
  sessionUuid: string;
  seq: number;
  role: "user" | "assistant";
  contentText: string;
  timestamp: string;
  sourceKind: string;
}
```

`Selector`:

```ts
type Selector =
  | { source?: "codex"; kind: "all"; root: string }
  | { source?: "codex"; kind: "date_range"; root: string; fromDate: string; toDate: string }
  | { source?: "codex"; kind: "cwd"; root: string; cwd: string }
  | { source?: "codex"; kind: "cwd_date_range"; root: string; cwd: string; fromDate: string; toDate: string };
```

Input selector JSON may omit `source`; canonical selectors returned by checkout commands include `source: "codex"`. `claude-code` is reserved/non-public and rejected at the CLI boundary.

`CoverageStatus`:

```ts
{
  requested: Selector | null;
  complete: boolean;
  freshness: "not_checked";
  coveringSelectors: CoverageRecord[];
}
```

`RequestedCoverageStatus`:

```ts
{
  requested: Selector;
  complete: boolean;
  freshness: "fresh" | "stale" | "missing";
  sourceFingerprint: string;
  sourceFileCount: number;
  coveringSelectors: CoverageInventoryStatus[];
  recommendedAction: "query" | "sync";
}
```

`CoverageRecord`:

```ts
{
  id: number;
  selector: Selector;
  sourceFingerprint: string;
  sourceFileCount: number;
  indexedSessionCount: number;
  completedAt: string;
  indexVersion: string;
}
```

`CoverageInventoryStatus`:

```ts
CoverageRecord & {
  freshness: "fresh" | "stale";
  currentSourceFingerprint: string;
  currentSourceFileCount: number;
}
```

## 来源

- 仓库内 `src/types.ts`
- 仓库内 `src/cli.ts`
- 仓库内 `src/query.ts`
