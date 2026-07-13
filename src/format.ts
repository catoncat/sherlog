import chalk from "chalk";
import { PROGRAM_NAME } from "./env";
import type {
  CwdCount,
  FindResult,
  MessageRecord,
  QueryNextAction,
  SessionListEntry,
  SessionRecord,
  StatsSummary,
  StatusSummary,
  SyncSummary,
} from "./types";

const SUMMARY_TEXT_BUDGET = 220;
const TRANSCRIPT_TEXT_BUDGET = 1_000;

export function printSyncSummary(summary: SyncSummary): void {
  console.log(chalk.bold.cyan(`${PROGRAM_NAME} sync`));
  console.log(`selector: ${JSON.stringify(summary.selector)}`);
  console.log(`scanned:  ${summary.scanned}`);
  console.log(`added:    ${summary.added}`);
  console.log(`updated:  ${summary.updated}`);
  console.log(`skipped:  ${summary.skipped}`);
  console.log(`filtered: ${summary.filtered}`);
  console.log(`removed:  ${summary.removed}`);
  console.log(`errors:   ${summary.errors}`);
  const writtenCoverage = summary.coverage.staleReason === "source_content_changed"
    ? "written (soft stale: active Codex tail changed; query is available, retry sync later)"
    : "written";
  const unwrittenCoverage = summary.coverage.reason === "active_source_deferred"
    ? "not written (active Codex source changed before read; stable sources committed, retry sync)"
    : `not written (${summary.coverage.reason ?? "unknown"})`;
  console.log(`coverage: ${summary.coverage.written ? writtenCoverage : unwrittenCoverage}`);
  if (summary.errorDetails.length > 0) {
    console.log();
    console.log(chalk.bold.red("sync errors"));
    for (const detail of summary.errorDetails) {
      console.log(chalk.red(detail.filePath));
      console.log(chalk.red(`  ${detail.message}`));
    }
  }
}

export function printFindResults(
  query: string,
  results: FindResult[],
  scannedMessageCount: number,
  elapsedMs: number,
  showStats: boolean,
  nextAction?: QueryNextAction,
): void {
  // 效率回述(中性事实):检索覆盖的语料规模 + 结果数 + 端到端耗时。诚实分母
  // 随搜索范围走,不出现编造的"省 X%"。SHLOG_STATS=0 时省略整段注解。
  const readout = showStats
    ? chalk.gray(` · 检索 ${formatCount(scannedMessageCount)} 条 · 结果 ${results.length} · ${elapsedMs}ms`)
    : "";
  console.log(chalk.bold.cyan(`${PROGRAM_NAME} find "${query}"`) + readout);
  if (results.length === 0) {
    console.log(chalk.yellow("没有找到结果"));
    printNextAction(nextAction);
    return;
  }

  for (const result of results) {
    console.log();
    console.log(chalk.bold(`[${result.rank}] ${result.title || "(no title)"}`));
    console.log(chalk.gray(`${result.startedAt} · ${result.cwd || "-"}`));
    const matchPoint = result.matchSeq === null ? "session-level" : `seq=${result.matchSeq}`;
    console.log(chalk.gray(`source=${result.sourceId} · uuid=${result.sessionUuid} · ${matchPoint} · matches=${result.matchCount}`));
    if (result.summaryText) {
      console.log(chalk.gray(trimSummary(result.summaryText)));
    }
    console.log(stripMarks(result.snippet));
    if (result.matchSeq === null) {
      console.log(chalk.gray(`next: ${PROGRAM_NAME} read-page ${result.sessionRef} --offset 0 --limit 40`));
    } else {
      console.log(chalk.gray(`next: ${PROGRAM_NAME} read-range ${result.sessionRef} --seq ${result.matchSeq} --query ${shellArg(query)}`));
    }
  }
  printNextAction(nextAction);
}

export function printReadRangeResult(
  session: SessionRecord,
  anchorSeq: number,
  messages: MessageRecord[],
  rangeStartSeq: number,
  rangeEndSeq: number,
  elapsedMs: number,
  showStats: boolean,
): void {
  console.log(chalk.bold.cyan(`${PROGRAM_NAME} read-range ${session.sessionUuid}`));
  console.log(chalk.gray(`${session.title || "(no title)"} · ${session.cwd || "-"}`));
  console.log(chalk.gray(`anchor=${anchorSeq} · range=${rangeStartSeq}-${rangeEndSeq}`));
  // 只报原始计数(读取/全量),不算 saved% —— "共 T 条"是功能信息(告诉还有多少
  // 可读),避免在"多读一点也许才对"的时刻给 under-read 诱因。SHLOG_STATS=0 时省略。
  if (showStats) {
    console.log(chalk.gray(`读取 ${messages.length} 条 / 本 session 共 ${session.messageCount} 条 · ${elapsedMs}ms`));
  }
  console.log();

  for (const message of messages) {
    const marker = message.seq === anchorSeq ? chalk.green(">>") : "  ";
    const role = message.role === "user" ? chalk.blue("U") : chalk.white("A");
    console.log(`${marker} [${message.seq}] ${role}${message.elision ? ` ${message.timestamp}` : ""} ${formatTranscriptMessage(message)}`);
    printElisionMetadata(message);
  }
}

export function printReadPage(
  session: SessionRecord,
  offset: number,
  limit: number,
  totalCount: number,
  hasMore: boolean,
  messages: MessageRecord[],
  elapsedMs: number,
  showStats: boolean,
): void {
  console.log(chalk.bold.cyan(`${PROGRAM_NAME} read-page ${session.sessionUuid}`));
  // total/offset/limit/hasMore 是功能信息(翻页必需),始终显示;仅末尾的端到端
  // 耗时归类为效率回述,受 SHLOG_STATS 控制。
  const elapsed = showStats ? ` · ${elapsedMs}ms` : "";
  console.log(chalk.gray(`${session.title || "(no title)"} · total=${totalCount} · offset=${offset} · limit=${limit} · hasMore=${hasMore}${elapsed}`));
  console.log();

  for (const message of messages) {
    const role = message.role === "user" ? chalk.blue("U") : chalk.white("A");
    console.log(`[${message.seq}] ${role}${message.elision ? ` ${message.timestamp}` : ""} ${formatTranscriptMessage(message)}`);
    printElisionMetadata(message);
  }
}

export function printSessionList(results: SessionListEntry[], nextAction?: QueryNextAction): void {
  console.log(chalk.bold.cyan(`${PROGRAM_NAME} list`));
  if (results.length === 0) {
    console.log(chalk.yellow("没有匹配的 session"));
    printNextAction(nextAction);
    return;
  }
  for (const [index, entry] of results.entries()) {
    console.log();
    console.log(chalk.bold(`[${index + 1}] ${entry.title || "(no title)"}`));
    console.log(chalk.gray(`${entry.endedAt} · ${entry.cwd || "-"} · msgs=${entry.messageCount}`));
    console.log(chalk.gray(`uuid=${entry.sessionUuid}`));
    if (entry.summaryText) {
      console.log(chalk.gray(trimSummary(entry.summaryText)));
    }
  }
}

export function printStats(stats: StatsSummary): void {
  console.log(chalk.bold.cyan(`${PROGRAM_NAME} stats`));
  console.log(`sessions:        ${stats.sessionCount}`);
  console.log(`messages:        ${stats.messageCount}`);
  console.log(`earliest:        ${stats.earliestStartedAt ?? "-"}`);
  console.log(`latest:          ${stats.latestEndedAt ?? "-"}`);
  console.log(`last_sync_at:    ${stats.lastSyncAt ?? "-"}`);
  console.log(`index_version:   ${stats.indexVersion}`);
  console.log(`db_path:         ${stats.dbPath}`);
  console.log(`db_size_bytes:   ${stats.dbSizeBytes}`);
  console.log(`coverage_count:  ${stats.coverage.length}`);
  if (stats.topCwds.length > 0) {
    console.log();
    console.log(chalk.bold("top cwds"));
    const width = Math.max(...stats.topCwds.map((row: CwdCount) => row.cwd.length));
    for (const row of stats.topCwds) {
      console.log(`  ${row.cwd.padEnd(width)}  ${row.count}`);
    }
  }
}

export function printStatus(status: StatusSummary): void {
  console.log(chalk.bold.cyan(`${PROGRAM_NAME} status`));
  console.log(`cwd:            ${status.context.cwd}`);
  console.log(`root:           ${status.context.root}`);
  console.log(`db_path:        ${status.context.dbPath}`);
  console.log(`source_files:   ${status.sourceInventory.totalFiles}`);
  console.log(`source_dates:   ${status.sourceInventory.pathDateRange.from ?? "-"}..${status.sourceInventory.pathDateRange.to ?? "-"}`);
  console.log(`index_exists:   ${status.index.exists}`);
  console.log(`sessions:       ${status.index.sessionCount}`);
  console.log(`messages:       ${status.index.messageCount}`);
  console.log(`coverage_count: ${status.coverage.length}`);
  if (status.requestedCoverage) {
    console.log(`requested_coverage: ${status.requestedCoverage.freshness}`);
    console.log(`stale_reason:       ${status.requestedCoverage.staleReason}`);
    console.log(`recommended_action:  ${status.requestedCoverage.recommendedAction}`);
    console.log(`source_file_count:   ${status.requestedCoverage.sourceFileCount}`);
    console.log(`covering_selectors:  ${status.requestedCoverage.coveringSelectors.length}`);
  }
  if (status.sourceInventory.cwdGroups.length > 0) {
    console.log();
    console.log(chalk.bold("source cwd groups"));
    for (const group of status.sourceInventory.cwdGroups.slice(0, 10)) {
      console.log(`  ${group.fileCount.toString().padStart(4)}  ${group.cwd}`);
    }
  }
}

// 千分位,保证测试可确定性断言(不依赖 locale)。
function formatCount(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function trimSummary(text: string): string {
  return trimText(text, SUMMARY_TEXT_BUDGET);
}

function trimTranscriptMessage(text: string): string {
  return trimText(text, TRANSCRIPT_TEXT_BUDGET);
}

function formatTranscriptMessage(message: MessageRecord): string {
  if (message.elision) return collapseWhitespace(message.contentText);
  return trimTranscriptMessage(message.contentText);
}

function printElisionMetadata(message: MessageRecord): void {
  if (!message.elision) return;
  const elision = message.elision;
  console.log(chalk.gray(`   elided ${elision.omittedCharCount}/${elision.originalCharCount} chars (${elision.strategy}); ${elision.hint}`));
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function collapseWhitespace(text: string): string {
  return trimText(text, Number.MAX_SAFE_INTEGER);
}

function trimText(text: string, limit: number): string {
  // OPTIMIZATION: Avoid expensive regex replace operations (text.replace(/\s+/g, " "))
  // on large strings. Use a single-pass loop with charCodeAt to track spaces
  // and truncate exactly when the limit is reached.
  let res = "";
  let inSpace = false;
  const len = text.length;
  let i = 0;

  // Skip leading spaces
  while (i < len && text.charCodeAt(i) <= 32) {
    i++;
  }

  for (; i < len; i++) {
    if (text.charCodeAt(i) <= 32) {
      if (!inSpace) {
        res += " ";
        inSpace = true;
      }
    } else {
      res += text[i];
      inSpace = false;
    }

    if (res.length >= limit) {
      // Check if remaining characters are all spaces
      let hasMore = false;
      for (let j = i + 1; j < len; j++) {
        if (text.charCodeAt(j) > 32) {
          hasMore = true;
          break;
        }
      }
      if (hasMore) {
        if (res.endsWith(" ")) {
          res = res.slice(0, -1);
        }
        res += "…";
      } else {
        if (res.endsWith(" ")) {
          res = res.slice(0, -1);
        }
      }
      break;
    }
  }

  if (i === len && res.endsWith(" ")) {
    res = res.slice(0, -1);
  }

  return res;
}

function stripMarks(snippet: string): string {
  return snippet.replaceAll("<mark>", "").replaceAll("</mark>", "");
}

function printNextAction(nextAction: QueryNextAction | undefined): void {
  if (!nextAction) return;
  console.log(chalk.gray("next:"));
  for (const step of nextAction.steps) {
    console.log(chalk.gray(`  - ${step}`));
  }
}
