# Sherlog JSON Schema

## find

Top-level shape:

```ts
{
  query: string;
  sourceIds: Array<"codex" | "claude-code" | "pi">;
  sort: "relevance" | "ended" | "started";
  excludedSessions: string[];
  results: FindResult[];
  scannedMessageCount: number; // 检索覆盖范围(selector 限定后)内的消息总数,做诚实分母
  coverage: CoverageStatus;
  coverageBySource?: Array<{ sourceId: "codex" | "claude-code" | "pi"; coverage: CoverageStatus }>;
  nextAction?: QueryNextAction;
  elapsedMs: number; // 端到端耗时(进程启动到输出),仅 CLI 输出注入,非 query 层字段
}
```

`scannedMessageCount` 随 selector 范围收窄(全库 vs `--cwd` 子集),用于「从 ~N 条历史里定位」的诚实回述,不要据此编造「省 X%」。`elapsedMs` 由 CLI 层在产出输出时用 `performance.now()` 注入,`read-range` / `read-page` 的 JSON 同样带 `elapsedMs`。

`FindResult`:

```ts
{
  rank: number;
  sourceId: "codex" | "claude-code" | "pi";
  sessionUuid: string;
  sessionRef: string;
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

`find` defaults to cross-source recall across public indexed sources. Use
`sourceIds` to see which sources participated. Use each result's `sessionRef`
as the read command input; for Codex it is usually the bare UUID, while
Claude Code and Pi refs are source-qualified such as `claude-code:<id>` or `pi:<id>`.

`matchSource = "session"` means the hit came from session-level fields such as title, derived summary, compact handoff, or reasoning summary rather than a concrete message. In that case `matchSeq` is `null`; use `read-page` first instead of fabricating a `read-range --seq` anchor.

`QueryNextAction` appears on `find` / `list` when the command cannot prove the target coverage is fresh enough for the requested conclusion. For Codex `find`, non-empty results no longer get a retry gate for `source_content_changed` soft stale, which commonly means the current session file is still being appended. If non-empty `find` still returns `stale_or_missing_coverage`, treat it as a harder risk such as missing coverage, a changed source file set, or a non-Codex source staying conservative unless a follow-up `status` says otherwise.

```ts
{
  kind: "check_coverage_then_retry" | "choose_selector_then_check_coverage";
  reason:
    | "zero_results_with_unconfirmed_selector_coverage"
    | "zero_results_without_selector"
    | "stale_or_missing_coverage";
  selector?: Selector;
  steps: string[];
  commands?: Array<{ label: string; recommended: boolean; argv: string[]; selector?: Selector }>;
}
```

Treat it as a retry gate for zero results, explicit completeness questions, missing coverage, and source-set changes. If `status.requestedCoverage.staleReason === "source_content_changed"` and `recommendedAction === "query"`, prefer querying/reading the existing index first; sync only when the answer may depend on the latest active-session tail. Otherwise choose/check the same selector, run `sync` only if `status.requestedCoverage.recommendedAction === "sync"`, then retry `find` before concluding the current result set is complete.

## read-range

```ts
{
  session: SessionRecord;
  anchorSeq: number;
  rangeStartSeq: number;
  rangeEndSeq: number;
  messages: MessageRecord[];
  coverage: { entries: CoverageRecord[] };
  elapsedMs: number; // 端到端耗时(进程启动到输出),仅 CLI 输出注入,非 query 层字段
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
  elapsedMs: number; // 端到端耗时(进程启动到输出),仅 CLI 输出注入,非 query 层字段
}
```

## list

```ts
{
  query: {
    sourceId?: "codex" | "claude-code" | "pi";
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
errors in `--json` mode for expected index setup and read failures:

```ts
{
  error:
    | {
        code: "index_unavailable";
        message: string;
        dbPath: string;
        hint: string;
        nextAction: {
          kind: "bootstrap_index";
          reason: "index_unavailable";
          commands: Array<{
            label: string;
            when: string;
            recommended: boolean;
            argv: string[];
            selector: Selector;
          }>;
        };
      }
    | { code: "index_schema_upgrade_required"; message: string; dbPath: string; missingColumns: string[]; hint: string }
    | {
        code: "session_not_found";
        message: string;
        sessionRef: string;
        sourceId: SessionSourceId;
        nativeSessionId: string;
        hint: string;
        nextAction: {
          kind: "check_coverage_then_retry_read";
          reason: "session_not_found";
          steps: string[];
          commands: Array<{
            label: string;
            recommended: boolean;
            argv: string[];
          }>;
        };
      };
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
    sourceFileSetFingerprint: string;
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
  sourceId: "codex" | "claude-code" | "pi";
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
  | { source?: "codex" | "claude-code" | "pi"; kind: "all"; root: string }
  | { source?: "codex" | "claude-code" | "pi"; kind: "date_range"; root: string; fromDate: string; toDate: string }
  | { source?: "codex" | "claude-code" | "pi"; kind: "cwd"; root: string; cwd: string }
  | { source?: "codex" | "claude-code" | "pi"; kind: "cwd_date_range"; root: string; cwd: string; fromDate: string; toDate: string };
```

Input selector JSON may omit `source`; canonical selectors returned by public CLI commands include the resolved source id. `claude-code` and `pi` are public but experimental CLI sources. These public CLI schemas still should not be read as stable raw-format promises; non-Codex support may move toward different SDK/session contracts in later releases.

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
  staleReason: "none" | "missing" | "source_content_changed" | "source_set_changed";
  sourceFingerprint: string;
  sourceFileSetFingerprint: string;
  sourceFileCount: number;
  coveringSelectors: CoverageInventoryStatus[];
  recommendedAction: "query" | "sync";
}
```

`source_content_changed` means an existing source file changed while the selected
file set stayed stable. This is based on `sourceFileSetFingerprint`, not
`sourceFileCount`; same-count file replacement remains `source_set_changed`.
For Codex this often happens because the current conversation JSONL is still
growing; when paired with `recommendedAction: "query"`, the existing index may
be useful, but it is not proof of the latest tail. Other sources may still pair
`source_content_changed` with `recommendedAction: "sync"`. `source_set_changed`
means files entered or left the selected snapshot and is a stronger reason to
sync before a completeness claim.

`CoverageRecord`:

```ts
{
  id: number;
  selector: Selector;
  sourceFingerprint: string;
  sourceFileSetFingerprint: string;
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
  currentSourceFileSetFingerprint: string;
  currentSourceFileCount: number;
}
```

## 来源

- 仓库内 `src/types.ts`
- 仓库内 `src/cli.ts`
- 仓库内 `src/query.ts`
