import { performance } from "node:perf_hooks";
import { existsSync } from "node:fs";
import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import {
  DEFAULT_DB_PATH,
  migrateLegacyDataDirIfNeeded,
  PROGRAM_NAME,
  statsReadoutEnabled,
} from "./env";
import { IndexSchemaUpgradeRequiredError, IndexUnavailableError, listCoverageRecords, withReadDb } from "./db";
import { evaluateCoverageRecord, evaluateRequestedCoverage } from "./coverage-freshness";
import { buildEvidenceReadAction } from "./evidence-read";
import { getSessionSourceAdapter, listSessionSourceAdapters } from "./sources";

// One-shot migration from legacy cxs data dirs to the current shlog state dir.
// Runs before any subcommand so `shlog stats` etc. see the migrated db, not
// just `shlog sync`. Idempotent + silent on failure (worst case is a re-sync).
migrateLegacyDataDirIfNeeded();
import {
  printFindResults,
  printReadPage,
  printReadRangeResult,
  printSessionList,
  printStats,
  printStatus,
  printSyncSummary,
} from "./format";
import { SyncError, syncSessions } from "./indexer";
import {
  collectStats,
  findSessions,
  getMessagePage,
  getMessageRange,
  listSessionSummaries,
  SessionNotFoundError,
} from "./query";
import { DEFAULT_MAX_MESSAGE_CHARS } from "./query/message-elision";
import { canonicalizeSelector, parseSelectorJson, SelectorParseError, selectorSource } from "./selector";
import { collectStatus } from "./status";
import { SyncLockTimeoutError } from "./sync-lock";
import type {
  CoverageStatus,
  FindResult,
  FindSort,
  FindSummary,
  QueryNextAction,
  RequestedCoverageStatus,
  Selector,
  SessionListSort,
  SessionSourceId,
} from "./types";

const program = new Command();

program
  .name(PROGRAM_NAME)
  .description("Sherlog 渐进式检索 CLI")
  .version(packageJson.version);

program
  .command("status")
  .description("返回执行上下文、source inventory、index 与 coverage 状态")
  .option("--source <id>", `session source (public: ${publicSourceLabel()})`)
  .option("--root <dir>", "覆盖默认 sessions 根目录，也作为 selector 默认 root")
  .option("--selector <json>", "检查指定 selector 的 coverage/freshness（只读，不同步）")
  .option("--cwd <path>", "检查指定 cwd selector 的 coverage/freshness")
  .option("--db <path>", "覆盖默认数据库路径", DEFAULT_DB_PATH)
  .option("--json", "输出 JSON")
  .action(async (options) => {
    try {
      const sourceId = publicSource(options.source);
      const selector = optionalSelector({ ...options, source: sourceId });
      const status = await collectStatus({ sourceId, rootDir: options.root, dbPath: options.db, cwd: process.cwd(), selector: selector ?? undefined });
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      printStatus(status);
    } catch (error) {
      if (error instanceof SourceOptionError) {
        emitSourceError(error, Boolean(options.json));
        return;
      }
      if (error instanceof SelectorParseError) {
        emitSelectorError(error, Boolean(options.json));
        return;
      }
      throw error;
    }
  });

program
  .command("sync")
  .description("扫描并同步本地 agent sessions 到 SQLite 索引")
  .option("--source <id>", `session source (public: ${publicSourceLabel()})`)
  .option("--root <dir>", "同步指定 sessions 根目录；也作为 selector 默认 root")
  .option("--selector <json>", "结构化同步范围 JSON")
  .option("--cwd <path>", "同步指定 cwd selector")
  .option("--db <path>", "覆盖默认数据库路径", DEFAULT_DB_PATH)
  .option("--best-effort", "即使部分文件失败也继续写入可成功部分")
  .option("--prune", "删除所选范围内已从 source 消失的旧索引行")
  .option("--json", "输出 JSON")
  .action(async (options) => {
    try {
      const sourceId = publicSource(options.source);
      const selector = syncSelector({ ...options, source: sourceId });
      const summary = await syncSessions({
        dbPath: options.db,
        sourceId,
        selector,
        bestEffort: options.bestEffort,
        prune: options.prune,
      });
      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      printSyncSummary(summary);
    } catch (error) {
      if (error instanceof SyncError) {
        if (options.json) {
          console.error(JSON.stringify(error.summary, null, 2));
        } else {
          printSyncSummary(error.summary);
        }
        process.exitCode = 1;
        return;
      }
      if (error instanceof SyncLockTimeoutError) {
        if (options.json) {
          console.error(JSON.stringify({ error: error.message }, null, 2));
        } else {
          console.error(error.message);
        }
        process.exitCode = 1;
        return;
      }
      if (error instanceof SourceOptionError) {
        emitSourceError(error, Boolean(options.json));
        return;
      }
      if (error instanceof SelectorParseError) {
        emitSelectorError(error, Boolean(options.json));
        return;
      }
      throw error;
    }
  });

program
  .command("find <query>")
  .description("搜索相关 session，返回最小必要命中")
  .option("--source <id>", `session source filter (public: all|${publicSourceLabel()}; default: all)`)
  .option("-n, --limit <n>", "返回条数", "10")
  .option("--root <dir>", "限定到指定 sessions 根目录；也作为 selector 默认 root")
  .option("--selector <json>", "结构化查询范围 JSON")
  .option("--cwd <path>", "限定到指定 cwd selector")
  .option("--sort <key>", "排序键：relevance|ended|started", "relevance")
  .option("--exclude-session <uuid>", "排除指定 session_uuid；可重复", collectValues, [])
  .option("--db <path>", "覆盖默认数据库路径", DEFAULT_DB_PATH)
  .option("--json", "输出 JSON")
  .action(async (query, options) => {
    await runReadCommand(Boolean(options.json), async () => {
      const limit = parsePositiveInt(options.limit, 10);
      const sort = normalizeFindSort(options.sort);
      const sourceIds = publicFindSources(options.source, options.selector);
      const summaries = await Promise.all(sourceIds.map(async (sourceId) => {
        const selector = optionalSelector({ ...options, source: sourceId, rootOnlySelector: true });
        const summary = findSessions(options.db, query, limit, selector, {
          sourceId,
          sort,
          excludeSessions: options.excludeSession ?? [],
        });
        const coverageSelector = selector ?? defaultAllSelector(sourceId);
        const coverageAssessment = await assessFindCoverage(
          options.db,
          coverageSelector,
          "this find",
          summary.results.length,
          summary.coverage,
        );
        return {
          ...summary,
          coverage: coverageAssessment.coverage,
          coverageBySource: [{ sourceId, coverage: coverageAssessment.coverage }],
          nextAction: coverageAssessment.nextAction,
        };
      }));
      const result = mergeFindSummaries(query, sort, options.excludeSession ?? [], summaries, limit);
      // performance.now() 自 timeOrigin(进程启动)起算 ≈ 本次端到端耗时,
      // 含 better-sqlite3 模块加载;shlog 是一次性进程,所以这就是诚实的端到端。
      const elapsedMs = Math.round(performance.now());
      if (options.json) {
        console.log(JSON.stringify({
          ...result,
          results: result.results.map((findResult) => ({
            ...findResult,
            evidenceRead: buildEvidenceReadAction({ ...findResult, query: result.query }),
          })),
          elapsedMs,
        }, null, 2));
        return;
      }
      printFindResults(result.query, result.results, result.scannedMessageCount, elapsedMs, statsReadoutEnabled(), result.nextAction);
    });
  });

program
  .command("read-range <sessionUuid>")
  .description("围绕命中点读取局部上下文；必须显式传 session_uuid")
  .option("--source <id>", `session source (public: ${publicSourceLabel()})`)
  .option("--seq <n>", "显式指定锚点 seq")
  .option("--query <query>", "用 query 在该 session 内重新定位命中点")
  .option("--before <n>", "前文条数", "2")
  .option("--after <n>", "后文条数", "2")
  .option("--max-message-chars <n>", "单条超大消息最多保留的字符数；0 表示不省略", String(DEFAULT_MAX_MESSAGE_CHARS))
  .option("--db <path>", "覆盖默认数据库路径", DEFAULT_DB_PATH)
  .option("--json", "输出 JSON")
  .action((sessionUuid, options) => {
    runReadCommand(Boolean(options.json), () => {
      const sourceId = publicReadSource(options.source, sessionUuid);
      const result = getMessageRange(options.db, sessionRefForSource(sessionUuid, sourceId), {
        seq: optionalInt(options.seq),
        query: options.query,
        before: parsePositiveInt(options.before, 2),
        after: parsePositiveInt(options.after, 2),
        maxMessageChars: parseNonNegativeInt(options.maxMessageChars, DEFAULT_MAX_MESSAGE_CHARS),
      });
      const elapsedMs = Math.round(performance.now());
      if (options.json) {
        console.log(JSON.stringify({ ...result, elapsedMs }, null, 2));
        return;
      }
      printReadRangeResult(
        result.session,
        result.anchorSeq,
        result.messages,
        result.rangeStartSeq,
        result.rangeEndSeq,
        elapsedMs,
        statsReadoutEnabled(),
      );
    }, {
      dbPath: options.db,
      retryReadArgv: (error) => buildReadRangeRetryArgv(error.sessionRef, options),
    });
  });

program
  .command("read-page <sessionUuid>")
  .description("顺序分页读取某个 session 的消息")
  .option("--source <id>", `session source (public: ${publicSourceLabel()})`)
  .option("--offset <n>", "起始 offset", "0")
  .option("--limit <n>", "页大小", "20")
  .option("--max-message-chars <n>", "单条超大消息最多保留的字符数；0 表示不省略", String(DEFAULT_MAX_MESSAGE_CHARS))
  .option("--db <path>", "覆盖默认数据库路径", DEFAULT_DB_PATH)
  .option("--json", "输出 JSON")
  .action((sessionUuid, options) => {
    runReadCommand(Boolean(options.json), () => {
      const sourceId = publicReadSource(options.source, sessionUuid);
      const result = getMessagePage(
        options.db,
        sessionRefForSource(sessionUuid, sourceId),
        parseNonNegativeInt(options.offset, 0),
        parsePositiveInt(options.limit, 20),
        { maxMessageChars: parseNonNegativeInt(options.maxMessageChars, DEFAULT_MAX_MESSAGE_CHARS) },
      );
      const elapsedMs = Math.round(performance.now());
      if (options.json) {
        console.log(JSON.stringify({ ...result, elapsedMs }, null, 2));
        return;
      }
      printReadPage(
        result.session,
        result.offset,
        result.limit,
        result.totalCount,
        result.hasMore,
        result.messages,
        elapsedMs,
        statsReadoutEnabled(),
      );
    }, {
      dbPath: options.db,
      retryReadArgv: (error) => buildReadPageRetryArgv(error.sessionRef, options),
    });
  });

program
  .command("list")
  .description("列出已索引的 session（不做全文检索）")
  .option("--source <id>", `session source (public: ${publicSourceLabel()})`)
  .option("--cwd <needle>", "cwd 子串过滤（大小写不敏感）")
  .option("--since <iso>", "只看 ended_at >= 指定时间的 session")
  .option("--root <dir>", "限定到指定 sessions 根目录；也作为 selector 默认 root")
  .option("--selector <json>", "结构化查询范围 JSON")
  .option("--sort <key>", "排序键：ended|started|messages", "ended")
  .option("-n, --limit <n>", "返回条数", "20")
  .option("--db <path>", "覆盖默认数据库路径", DEFAULT_DB_PATH)
  .option("--json", "输出 JSON")
  .action((options) => {
    runReadCommand(Boolean(options.json), () => {
      const sourceId = publicSource(options.source);
      const sort = normalizeListSort(options.sort);
      const selector = optionalSelector({ selector: options.selector, root: options.root, source: sourceId, rootOnlySelector: true });
      const result = listSessionSummaries(options.db, {
        sourceId,
        cwd: options.cwd,
        since: options.since,
        selector: selector ?? undefined,
        sort,
        limit: parsePositiveInt(options.limit, 20),
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      printSessionList(result.results, result.nextAction);
    });
  });

program
  .command("stats")
  .description("展示索引状态统计")
  .option("--source <id>", `session source (public: ${publicSourceLabel()})`)
  .option("--db <path>", "覆盖默认数据库路径", DEFAULT_DB_PATH)
  .option("--json", "输出 JSON")
  .action((options) => {
    runReadCommand(Boolean(options.json), () => {
      const sourceId = publicSource(options.source);
      const summary = collectStats(options.db, sourceId);
      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      printStats(summary);
    });
  });

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function optionalInt(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeListSort(value: string | undefined): SessionListSort {
  if (value === "started" || value === "messages") return value;
  return "ended";
}

function normalizeFindSort(value: string | undefined): FindSort {
  if (value === "ended" || value === "started") return value;
  return "relevance";
}

function collectValues(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

async function runReadCommand(
  jsonMode: boolean,
  action: () => void | Promise<void>,
  sessionNotFoundContext: { dbPath?: string; retryReadArgv?: (error: SessionNotFoundError) => string[] } = {},
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof SourceOptionError) {
      emitSourceError(error, jsonMode);
      return;
    }
    if (error instanceof IndexUnavailableError) {
      emitIndexUnavailableError(error, jsonMode);
      return;
    }
    if (error instanceof IndexSchemaUpgradeRequiredError) {
      emitIndexSchemaUpgradeRequiredError(error, jsonMode);
      return;
    }
    if (error instanceof SessionNotFoundError) {
      emitSessionNotFoundError(error, jsonMode, sessionNotFoundContext);
      return;
    }
    if (error instanceof SelectorParseError) {
      emitSelectorError(error, jsonMode);
      return;
    }
    throw error;
  }
}

class SourceOptionError extends Error {
  sourceId: string;

  constructor(sourceId: string) {
    super(`unsupported source "${sourceId}". Public sources in this release: ${publicSourceLabel()}.`);
    this.name = "SourceOptionError";
    this.sourceId = sourceId;
  }
}

function publicSource(value: string | undefined): SessionSourceId {
  const sourceId = (value ?? "codex").trim();
  const adapter = resolvePublicSourceAdapter(sourceId);
  if (adapter) return adapter.id;
  throw new SourceOptionError(sourceId || "(empty)");
}

function publicFindSources(value: string | undefined, selectorJson?: string): SessionSourceId[] {
  const source = value?.trim();
  if (source && source !== "all") return [publicSource(source)];

  const selectorSource = sourceFromSelectorJson(selectorJson);
  if (selectorSource) return [selectorSource];

  return getPublicSourceAdapters().map((adapter) => adapter.id);
}

function publicReadSource(value: string | undefined, sessionRef: string): SessionSourceId {
  if (typeof value === "string") return publicSource(value);
  return sourceFromSessionRef(sessionRef) ?? publicSource(undefined);
}

function publicSourceLabel(): string {
  return getPublicSourceAdapters()
    .map((adapter) => adapter.id)
    .join("|");
}

function resolvePublicSourceAdapter(sourceId: string) {
  try {
    const adapter = getSessionSourceAdapter(sourceId as SessionSourceId);
    return adapter.public ? adapter : null;
  } catch {
    return null;
  }
}

function getPublicSourceAdapters() {
  return listSessionSourceAdapters().filter((adapter) => adapter.public);
}

function sourceFromSelectorJson(selectorJson: string | undefined): SessionSourceId | null {
  if (!selectorJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(selectorJson) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.source !== "string") return null;
  return publicSource(parsed.source);
}

function sourceFromSessionRef(sessionRef: string): SessionSourceId | null {
  const separator = sessionRef.indexOf(":");
  if (separator <= 0) return null;
  return publicSource(sessionRef.slice(0, separator));
}

function mergeFindSummaries(
  query: string,
  sort: FindSort,
  excludedSessions: string[],
  summaries: FindSummary[],
  limit: number,
): FindSummary {
  if (summaries.length === 1) return summaries[0]!;

  const results = mergeFindResults(summaries.flatMap((summary) => summary.results), sort, limit);
  const coverageBySource = summaries.flatMap((summary) => summary.coverageBySource ?? summary.sourceIds.map((sourceId) => ({
    sourceId,
    coverage: summary.coverage,
  })));
  const coverage = {
    requested: null,
    complete: coverageBySource.every((entry) => entry.coverage.complete),
    freshness: mergedCoverageFreshness(coverageBySource.map((entry) => entry.coverage)),
    coveringSelectors: coverageBySource.flatMap((entry) => entry.coverage.coveringSelectors),
  };
  const coverageActions = summaries
    .map((summary) => summary.nextAction)
    .filter((action): action is QueryNextAction => action?.reason === "stale_or_missing_coverage");
  return {
    query,
    sourceIds: summaries.flatMap((summary) => summary.sourceIds),
    sort,
    excludedSessions: uniqueNonEmpty(excludedSessions),
    results,
    scannedMessageCount: summaries.reduce((total, summary) => total + summary.scannedMessageCount, 0),
    coverage,
    coverageBySource,
    nextAction: coverageActions.length > 0
      ? buildCrossSourceCoverageNextAction(coverageActions)
      : results.length === 0
        ? buildCrossSourceZeroResultsNextAction()
        : undefined,
  };
}

function mergeFindResults(results: FindResult[], sort: FindSort, limit: number): FindResult[] {
  const deduped = new Map<string, FindResult>();
  for (const result of results) {
    const key = `${result.sourceId}\0${result.sessionRef}`;
    const existing = deduped.get(key);
    if (!existing || result.rank < existing.rank || (result.rank === existing.rank && result.score > existing.score)) {
      deduped.set(key, result);
    }
  }

  const rows = [...deduped.values()];
  if (sort === "relevance") {
    return rows
      .map((result) => ({ ...result, score: reciprocalRankScore(result.rank) }))
      .sort(compareMergedRelevance)
      .slice(0, limit)
      .map((result, index) => ({ ...result, rank: index + 1 }));
  }

  return rows
    .sort((left, right) => compareMergedTime(left, right, sort))
    .slice(0, limit)
    .map((result, index) => ({ ...result, rank: index + 1 }));
}

function reciprocalRankScore(rank: number): number {
  return 1 / (60 + rank);
}

function compareMergedRelevance(left: FindResult, right: FindResult): number {
  if (right.score !== left.score) return right.score - left.score;
  if (right.endedAt > left.endedAt) return 1;
  if (right.endedAt < left.endedAt) return -1;
  return compareStableFindResult(left, right);
}

function compareMergedTime(left: FindResult, right: FindResult, sort: FindSort): number {
  const leftTime = sort === "started" ? left.startedAt : left.endedAt;
  const rightTime = sort === "started" ? right.startedAt : right.endedAt;
  if (rightTime > leftTime) return 1;
  if (rightTime < leftTime) return -1;
  if (right.score !== left.score) return right.score - left.score;
  return compareStableFindResult(left, right);
}

function compareStableFindResult(left: FindResult, right: FindResult): number {
  const sourceOrder = left.sourceId.localeCompare(right.sourceId);
  if (sourceOrder !== 0) return sourceOrder;
  return left.sessionRef.localeCompare(right.sessionRef);
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

function buildCrossSourceZeroResultsNextAction(): QueryNextAction {
  return {
    kind: "choose_selector_then_check_coverage",
    reason: "zero_results_without_selector",
    steps: [
      `Run ${PROGRAM_NAME} status --source <id> for each relevant public source and selector.`,
      `If any source reports requestedCoverage.recommendedAction as sync, run ${PROGRAM_NAME} sync --source <id> for that source and selector.`,
      "Retry this find before concluding nothing exists.",
    ],
  };
}

async function assessFindCoverage(
  dbPath: string,
  selector: Selector,
  commandLabel: string,
  resultCount: number,
  unconfirmedCoverage: CoverageStatus,
): Promise<{ coverage: CoverageStatus; nextAction?: QueryNextAction }> {
  if (!existsSync(dbPath)) return { coverage: unconfirmedCoverage };

  const sourceId = selectorSource(selector);
  const source = getSessionSourceAdapter(sourceId);
  const files = await source.collectFiles(selector.root);
  const snapshot = await source.snapshotFromFiles(selector, files);
  const coverageRecords = withReadDb(dbPath, (db) => listCoverageRecords(db, sourceId));
  const coverageInventory = [];
  for (const entry of coverageRecords) {
    const entrySnapshot = await source.snapshotFromFiles(entry.selector, files);
    coverageInventory.push(evaluateCoverageRecord(entry, entrySnapshot));
  }
  const requestedCoverage = evaluateRequestedCoverage(snapshot, coverageInventory);
  const staleReason = requestedCoverage.staleReason;
  const coverage: CoverageStatus = {
    requested: requestedCoverage.requested,
    complete: requestedCoverage.complete,
    freshness: requestedCoverage.freshness,
    staleReason,
    coveringSelectors: requestedCoverage.coveringSelectors,
  };
  if (requestedCoverage.freshness === "fresh") return { coverage };
  if (sourceId === "codex" && staleReason === "source_content_changed" && resultCount > 0) return { coverage };

  const syncArgv = syncArgvForSelector(snapshot.selector);
  return {
    coverage,
    nextAction: {
      kind: "check_coverage_then_retry",
      reason: "stale_or_missing_coverage",
      selector: snapshot.selector,
      steps: [
        indexedCoverageStep(staleReason),
        `Run ${syncArgv.join(" ")}.`,
        `Retry ${commandLabel} before treating current results as complete.`,
      ],
      commands: [
        {
          label: "refresh selector coverage",
          recommended: true,
          argv: syncArgv,
          selector: snapshot.selector,
        },
      ],
    },
  };
}

function mergedCoverageFreshness(coverages: CoverageStatus[]): CoverageStatus["freshness"] {
  if (coverages.every((coverage) => coverage.freshness === "fresh")) return "fresh";
  if (coverages.some((coverage) => coverage.freshness === "missing")) return "missing";
  if (coverages.some((coverage) => coverage.freshness === "stale")) return "stale";
  return "not_checked";
}

function indexedCoverageStep(staleReason: RequestedCoverageStatus["staleReason"]): string {
  if (staleReason === "missing") {
    return "Indexed coverage for this selector is missing; results may be incomplete or misleading.";
  }
  if (staleReason === "source_content_changed") {
    return "Indexed coverage for this selector only differs by existing source-file content; sync if this query needs the latest active-session tail.";
  }
  return "Indexed coverage for this selector has a changed source file set; results may be incomplete or misleading.";
}

function buildCrossSourceCoverageNextAction(actions: QueryNextAction[]): QueryNextAction {
  const commands = actions.flatMap((action) => action.commands ?? []);
  return {
    kind: "check_coverage_then_retry",
    reason: "stale_or_missing_coverage",
    steps: [
      "One or more searched sources have stale or missing coverage; merged results may be incomplete or misleading.",
      ...commands.filter((command) => command.recommended).map((command) => `Run ${command.argv.join(" ")}.`),
      "Retry this find before treating current results as complete.",
    ],
    commands,
  };
}

function syncArgvForSelector(selector: Selector): string[] {
  const sourceId = selectorSource(selector);
  const argv = [PROGRAM_NAME, "sync", "--source", sourceId, "--root", selector.root];
  if (selector.kind === "cwd") {
    argv.push("--cwd", selector.cwd);
  }
  if (selector.kind === "date_range" || selector.kind === "cwd_date_range") {
    argv.push("--selector", JSON.stringify(selector));
  }
  return argv;
}

function emitSourceError(error: SourceOptionError, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          error: {
            code: "unsupported_source",
            source: error.sourceId,
            message: error.message,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
}

function emitIndexUnavailableError(error: IndexUnavailableError, jsonMode: boolean): void {
  const nextAction = buildIndexBootstrapNextAction();
  const hint =
    `Run \`${PROGRAM_NAME} sync\` first to create the default Codex index. ` +
    `Only for explicitly current-project questions, run \`${PROGRAM_NAME} sync --cwd ${shellArg(process.cwd())}\` instead. ` +
    "No separate init command is needed; sync initializes and updates it.";
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          error: {
            code: "index_unavailable",
            message: error.message,
            dbPath: error.dbPath,
            hint,
            nextAction,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.error(`${error.message}\n${hint}`);
  }
  process.exitCode = 1;
}

function buildIndexBootstrapNextAction() {
  const sourceId: SessionSourceId = "codex";
  const root = getSessionSourceAdapter(sourceId).defaultRoot();
  return {
    kind: "bootstrap_index",
    reason: "index_unavailable",
    commands: [
      {
        label: "default Codex history",
        when: "first install or unscoped history query",
        recommended: true,
        argv: [PROGRAM_NAME, "sync"],
        selector: canonicalizeSelector({ source: sourceId, kind: "all", root }),
      },
      {
        label: "current working directory only",
        when: "question is explicitly scoped to the current working directory",
        recommended: false,
        argv: [PROGRAM_NAME, "sync", "--cwd", process.cwd()],
        selector: canonicalizeSelector({ source: sourceId, kind: "cwd", root, cwd: process.cwd() }),
      },
    ],
  };
}

function shellArg(value: string): string {
  return JSON.stringify(value);
}

function emitIndexSchemaUpgradeRequiredError(error: IndexSchemaUpgradeRequiredError, jsonMode: boolean): void {
  const hint =
    `Run \`${PROGRAM_NAME} sync --source codex --root <sessions-root>\` or the equivalent scoped sync to migrate the index, then retry.`;
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          error: {
            code: "index_schema_upgrade_required",
            message: error.message,
            dbPath: error.dbPath,
            missingColumns: error.missingColumns,
            hint,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.error(`${error.message}\n${hint}`);
  }
  process.exitCode = 1;
}

function emitSessionNotFoundError(
  error: SessionNotFoundError,
  jsonMode: boolean,
  context: { dbPath?: string; retryReadArgv?: (error: SessionNotFoundError) => string[] } = {},
): void {
  const nextAction = buildSessionNotFoundNextAction(error, context);
  const hint =
    `Sherlog only reads indexed sessions. The raw session may exist but not be synced yet, ` +
    `or the id/source may not match this index. Run \`${PROGRAM_NAME} status --source ${error.sourceId} --json\`; ` +
    `if coverage is missing or stale, run \`${PROGRAM_NAME} sync --source ${error.sourceId}\`, then retry.`;
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          error: {
            code: "session_not_found",
            message: error.message,
            sessionRef: error.sessionRef,
            sourceId: error.sourceId,
            nativeSessionId: error.nativeSessionId,
            hint,
            nextAction,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.error(`${error.message}\n${hint}`);
  }
  process.exitCode = 1;
}

function buildSessionNotFoundNextAction(
  error: SessionNotFoundError,
  context: { dbPath?: string; retryReadArgv?: (error: SessionNotFoundError) => string[] } = {},
) {
  const dbArgv = context.dbPath ? ["--db", context.dbPath] : [];
  return {
    kind: "check_coverage_then_retry_read",
    reason: "session_not_found",
    steps: [
      `Verify that ${error.sessionRef} is the right sessionRef and source. If needed, use a source-qualified ref such as ${error.sourceId}:${error.nativeSessionId}.`,
      `Run ${PROGRAM_NAME} status --source ${error.sourceId} --json to check index freshness.`,
      `If status reports missing or stale coverage, run ${PROGRAM_NAME} sync --source ${error.sourceId} and retry the read command.`,
    ],
    commands: [
      {
        label: "check source coverage",
        recommended: true,
        argv: [PROGRAM_NAME, "status", "--source", error.sourceId, ...dbArgv, "--json"],
      },
      {
        label: "refresh default source index",
        recommended: false,
        argv: [PROGRAM_NAME, "sync", "--source", error.sourceId, ...dbArgv],
      },
      {
        label: "retry read command",
        recommended: false,
        argv: context.retryReadArgv?.(error) ?? [PROGRAM_NAME, "read-page", error.sessionRef, ...dbArgv],
      },
    ],
  };
}

function buildReadRangeRetryArgv(
  sessionRef: string,
  options: { seq?: string; query?: string; before?: string; after?: string; maxMessageChars?: string; db?: string },
): string[] {
  const argv = [PROGRAM_NAME, "read-range", sessionRef];
  if (options.seq !== undefined) argv.push("--seq", options.seq);
  if (options.query !== undefined) argv.push("--query", options.query);
  if (options.before !== undefined) argv.push("--before", options.before);
  if (options.after !== undefined) argv.push("--after", options.after);
  if (isNonDefaultMaxMessageChars(options.maxMessageChars)) argv.push("--max-message-chars", options.maxMessageChars!);
  if (options.db) argv.push("--db", options.db);
  return argv;
}

function buildReadPageRetryArgv(
  sessionRef: string,
  options: { offset?: string; limit?: string; maxMessageChars?: string; db?: string },
): string[] {
  const argv = [PROGRAM_NAME, "read-page", sessionRef];
  if (options.offset !== undefined) argv.push("--offset", options.offset);
  if (options.limit !== undefined) argv.push("--limit", options.limit);
  if (isNonDefaultMaxMessageChars(options.maxMessageChars)) argv.push("--max-message-chars", options.maxMessageChars!);
  if (options.db) argv.push("--db", options.db);
  return argv;
}

function isNonDefaultMaxMessageChars(value: string | undefined): boolean {
  return value !== undefined && value !== String(DEFAULT_MAX_MESSAGE_CHARS);
}

function emitSelectorError(error: SelectorParseError, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(
      JSON.stringify(
        { error: { code: error.message.includes("requires --selector") ? "selector_required" : "invalid_selector", message: error.message } },
        null,
        2,
      ),
    );
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
}

function syncSelector(options: { selector?: string; root?: string; cwd?: string; source: SessionSourceId }): Selector {
  const selector = optionalSelector({
    selector: options.selector,
    root: options.root,
    cwd: options.cwd,
    source: options.source,
    rootOnlySelector: true,
  });
  if (selector) return selector;
  const root = getSessionSourceAdapter(options.source).defaultRoot();
  return canonicalizeSelector({ kind: "all", source: options.source, root });
}

function defaultAllSelector(sourceId: SessionSourceId): Selector {
  return canonicalizeSelector({ kind: "all", source: sourceId, root: getSessionSourceAdapter(sourceId).defaultRoot() });
}

function optionalSelector(options: { selector?: string; root?: string; cwd?: string; source: SessionSourceId; rootOnlySelector?: boolean }): Selector | null {
  if (options.selector && options.cwd) {
    throw new SelectorParseError("--selector and --cwd cannot be combined");
  }
  const root = options.root ?? getSessionSourceAdapter(options.source).defaultRoot();
  if (options.selector) {
    rejectNonPublicSelectorSource(options.selector);
    const selector = parseSelectorJson(options.selector, { defaultRoot: root, defaultSource: options.source });
    assertSelectorSourceMatches(selector, options.source);
    return selector;
  }
  if (options.cwd) return canonicalizeSelector({ kind: "cwd", source: options.source, root, cwd: options.cwd });
  if (options.rootOnlySelector && options.root) return canonicalizeSelector({ kind: "all", source: options.source, root });
  return null;
}

function rejectNonPublicSelectorSource(selectorJson: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(selectorJson) as unknown;
  } catch {
    return;
  }
  if (!isRecord(parsed) || typeof parsed.source !== "string") return;
  publicSource(parsed.source);
}

function assertSelectorSourceMatches(selector: Selector, sourceId: SessionSourceId): void {
  if (selectorSource(selector) !== sourceId) {
    throw new SelectorParseError("--source must match selector.source");
  }
}

function sessionRefForSource(sessionRef: string, sourceId: SessionSourceId): string {
  const separator = sessionRef.indexOf(":");
  if (separator > 0) {
    const prefix = sessionRef.slice(0, separator);
    const explicitSource = publicSource(prefix);
    if (explicitSource !== sourceId) throw new SelectorParseError("--source must match session source qualifier");
    return sessionRef;
  }
  return `${sourceId}:${sessionRef}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

program.parse();
