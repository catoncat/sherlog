#!/usr/bin/env -S node --import tsx

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn as childSpawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface LatencyStats {
  runs: number;
  samplesMs: number[];
  p50Ms: number;
  p95Ms: number;
}

interface TopHitRecord {
  sourceId: string;
  sessionRef: string;
  matchSource: string;
  matchSeq: number | null;
}

interface ReadProbeRecord extends LatencyStats {
  kind: "read-range" | "read-page";
  sourceId: string;
  sessionRef: string;
  argv: string[];
  messagesReturned: number;
  anchorSeq?: number;
  totalCount?: number;
}

interface PerQueryRecord extends LatencyStats {
  query: string;
  resultCount: number;
  scannedMessageCount: number;
  topHit: TopHitRecord | null;
  readRange: ReadProbeRecord | null;
  readPage: ReadProbeRecord | null;
}

interface CoverageCostSummary {
  statusMs: number;
  coverageCount: number;
  freshness: Record<string, number>;
  staleReasons: Record<string, number>;
  requestedCoverage: {
    freshness: string;
    staleReason: string;
    sourceFileCount: number;
    recommendedAction: string;
  } | null;
}

interface Report {
  generatedAt: string;
  sourceId: string;
  dbPath: string;
  rootDir: string;
  sessionCount: number;
  messageCount: number;
  syncMs: number;
  dbSizeBytes: number;
  runsPerQuery: number;
  readRunsPerProbe: number;
  coverage: CoverageCostSummary;
  perQuery: PerQueryRecord[];
}

interface FindJsonPayload {
  scannedMessageCount?: number;
  results?: Array<{
    sourceId?: string;
    sessionRef?: string;
    matchSource?: string;
    matchSeq?: number | null;
  }>;
}

interface ReadJsonPayload {
  anchorSeq?: number;
  totalCount?: number;
  messages?: unknown[];
}

interface StatsJsonPayload {
  sessionCount?: number;
  messageCount?: number;
  dbSizeBytes?: number;
}

interface StatusJsonPayload {
  coverage?: Array<{
    freshness?: string;
    sourceFileSetFingerprint?: string;
    currentSourceFileSetFingerprint?: string;
  }>;
  requestedCoverage?: {
    freshness?: string;
    staleReason?: string;
    sourceFileCount?: number;
    recommendedAction?: string;
  };
}

// Bench query 选取原则:
//  - 单 token 高频(hammerspoon/envchain): 检验最常见广义 fts 命中
//  - 短 token(sb): 检验 trigram fallback 路径
//  - 多 token 英文(fly deploy / edge tts): 检验多 term AND 路径
//  - CJK 短语(豆包输入法): 检验 CJK trigram 路径
//  - 中英混合(部署 health check): 检验 mixed match
const BENCH_QUERIES: string[] = [
  "hammerspoon",
  "envchain",
  "sb",
  "fly deploy",
  "edge tts",
  "豆包输入法",
  "部署 health check",
];

const DEFAULT_RUNS_PER_QUERY = 5; // 第 1 次作为 warmup,统计后续样本
const DEFAULT_READ_RUNS_PER_PROBE = 3; // 第 1 次作为 warmup,统计后续样本
const ROOT = resolve(import.meta.dirname, "..");
const CLI_ENTRY = resolve(ROOT, "src", "cli.ts");
const OUT_BASE = resolve(ROOT, "data", "shlog-perf");

interface CliArgs {
  root: string;
  db: string;
  source: string;
  jsonOnly: boolean;
  runsPerQuery: number;
  readRunsPerProbe: number;
}

function parseArgs(argv: string[]): CliArgs {
  let root = join(homedir(), ".codex", "sessions");
  let db = join(tmpdir(), `shlog-perf-${Date.now()}.db`);
  let source = "codex";
  let jsonOnly = false;
  let runsPerQuery = DEFAULT_RUNS_PER_QUERY;
  let readRunsPerProbe = DEFAULT_READ_RUNS_PER_PROBE;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = resolve(argv[++i] ?? root);
    } else if (a === "--db") {
      db = resolve(argv[++i] ?? db);
    } else if (a === "--source") {
      source = argv[++i] ?? source;
    } else if (a === "--runs") {
      runsPerQuery = parsePositiveInt(argv[++i], DEFAULT_RUNS_PER_QUERY);
    } else if (a === "--read-runs") {
      readRunsPerProbe = parsePositiveInt(argv[++i], DEFAULT_READ_RUNS_PER_PROBE);
    } else if (a === "--json-only") {
      jsonOnly = true;
    } else if (a === "--help" || a === "-h") {
      console.log("Usage: npm run eval:perf -- [--source <id>] [--root <dir>] [--db <path>] [--runs <n>] [--read-runs <n>] [--json-only]");
      process.exit(0);
    }
  }
  return { root, db, source, jsonOnly, runsPerQuery, readRunsPerProbe };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const args = parseArgs(process.argv.slice(2));

if (!existsSync(args.root)) {
  console.error(`error: --root not found: ${args.root}`);
  process.exit(1);
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  ms: number;
}

async function run(cmd: string[]): Promise<RunResult> {
  const t0 = performance.now();
  const result = await spawnAndCapture(cmd, ROOT);
  const ms = performance.now() - t0;
  return { ...result, ms };
}

function spawnAndCapture(cmd: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = childSpawn(cmd[0]!, cmd.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout!.setEncoding("utf8");
    proc.stderr!.setEncoding("utf8");
    proc.stdout!.on("data", (chunk: string) => { stdout += chunk; });
    proc.stderr!.on("data", (chunk: string) => { stderr += chunk; });
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

async function runOrThrow(cmd: string[]): Promise<RunResult> {
  const r = await run(cmd);
  if (r.exitCode !== 0) {
    throw new Error(`command failed (exit ${r.exitCode}): ${cmd.join(" ")}\n${r.stderr || r.stdout}`);
  }
  return r;
}

async function runJsonOrThrow<T>(cmd: string[]): Promise<{ run: RunResult; payload: T }> {
  const result = await runOrThrow(cmd);
  try {
    return { run: result, payload: JSON.parse(result.stdout) as T };
  } catch (error) {
    throw new Error(`command did not emit JSON: ${cmd.join(" ")}\n${String(error)}\n${result.stdout}`);
  }
}

async function benchJsonCommand<T>(cmd: string[], runs: number): Promise<{ latency: LatencyStats; payload: T }> {
  const samplesAll: number[] = [];
  let payload: T | null = null;
  for (let i = 0; i < runs; i++) {
    const result = await runJsonOrThrow<T>(cmd);
    samplesAll.push(result.run.ms);
    payload = result.payload;
  }
  if (!payload) throw new Error(`no payload produced for command: ${cmd.join(" ")}`);
  return { latency: latencyStats(samplesAll), payload };
}

function latencyStats(samplesAll: number[]): LatencyStats {
  const samples = samplesAll.length > 1 ? samplesAll.slice(1) : samplesAll;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    runs: samples.length,
    samplesMs: samplesAll.map((x) => Number(x.toFixed(2))),
    p50Ms: Number(median(sorted).toFixed(2)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
  };
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(samplesMs: number[], p: number): number {
  // 小样本下 p95 数学意义薄弱: 直接取 max 作为 worst-case 近似
  if (samplesMs.length === 0) return 0;
  if (p >= 0.95) return Math.max(...samplesMs);
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

function fmtMs(n: number): string {
  return n.toFixed(1).padStart(8);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function cliCommand(...command: string[]): string[] {
  return [process.execPath, "--import", "tsx", CLI_ENTRY, ...command];
}

function publicArgv(cmd: string[]): string[] {
  return ["shlog", ...cmd.slice(4)];
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = args.jsonOnly ? "" : join(OUT_BASE, stamp);
if (!args.jsonOnly) {
  mkdirSync(outDir, { recursive: true });
}

// 1. sync
const syncRun = await runOrThrow(cliCommand("sync", "--source", args.source, "--db", args.db, "--root", args.root, "--json"));
const syncMs = syncRun.ms;
let sessionCount = 0;
try {
  const parsed = JSON.parse(syncRun.stdout) as { scanned?: number };
  sessionCount = typeof parsed.scanned === "number" ? parsed.scanned : 0;
} catch {
  // 解析失败保持 0
}

// 2. coverage/freshness cost
const statusSelector = JSON.stringify({ source: args.source, kind: "all", root: args.root });
const statusResult = await runJsonOrThrow<StatusJsonPayload>(cliCommand(
  "status",
  "--source",
  args.source,
  "--root",
  args.root,
  "--selector",
  statusSelector,
  "--db",
  args.db,
  "--json",
));
const coverage = coverageCostSummary(statusResult.run, statusResult.payload);

// 3. find + raw-read probes
const perQuery: PerQueryRecord[] = [];
for (const q of BENCH_QUERIES) {
  const findCommand = cliCommand("find", q, "--source", args.source, "--db", args.db, "--limit", "10", "--json");
  const { latency, payload } = await benchJsonCommand<FindJsonPayload>(findCommand, args.runsPerQuery);
  const topHit = topHitFromFind(payload);
  perQuery.push({
    query: q,
    ...latency,
    resultCount: Array.isArray(payload.results) ? payload.results.length : 0,
    scannedMessageCount: typeof payload.scannedMessageCount === "number" ? payload.scannedMessageCount : 0,
    topHit,
    readRange: topHit ? await measureReadRange(topHit) : null,
    readPage: topHit ? await measureReadPage(topHit) : null,
  });
}

// 4. stats -> db size and indexed counts
const statsRun = await runJsonOrThrow<StatsJsonPayload>(cliCommand("stats", "--source", args.source, "--db", args.db, "--json"));
let dbSizeBytes = 0;
let messageCount = 0;
if (typeof statsRun.payload.dbSizeBytes === "number") dbSizeBytes = statsRun.payload.dbSizeBytes;
if (typeof statsRun.payload.sessionCount === "number" && statsRun.payload.sessionCount > 0) {
  sessionCount = statsRun.payload.sessionCount;
}
if (typeof statsRun.payload.messageCount === "number") {
  messageCount = statsRun.payload.messageCount;
}

const report: Report = {
  generatedAt: new Date().toISOString(),
  sourceId: args.source,
  dbPath: args.db,
  rootDir: args.root,
  sessionCount,
  messageCount,
  syncMs: Number(syncMs.toFixed(2)),
  dbSizeBytes,
  runsPerQuery: args.runsPerQuery,
  readRunsPerProbe: args.readRunsPerProbe,
  coverage,
  perQuery,
};

if (!args.jsonOnly) {
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outDir, "report.md"), buildMarkdown(report));
}

const readProbes = perQuery.flatMap((row) => [row.readRange, row.readPage].filter((probe): probe is ReadProbeRecord => probe !== null));
const slowest = [...perQuery].sort((a, b) => b.p95Ms - a.p95Ms)[0];
const slowestRead = [...readProbes].sort((a, b) => b.p95Ms - a.p95Ms)[0];
const summary = {
  outDir: outDir || null,
  sourceId: report.sourceId,
  sessionCount,
  messageCount,
  syncMs: report.syncMs,
  dbSizeBytes,
  coverage: report.coverage,
  queryCount: perQuery.length,
  readProbeCount: readProbes.length,
  slowestQuery: slowest ? { query: slowest.query, p95Ms: slowest.p95Ms } : null,
  slowestRead: slowestRead ? { kind: slowestRead.kind, p95Ms: slowestRead.p95Ms } : null,
};
console.log(JSON.stringify(args.jsonOnly ? report : summary, null, 2));

function topHitFromFind(payload: FindJsonPayload): TopHitRecord | null {
  const first = payload.results?.[0];
  if (!first || typeof first.sourceId !== "string" || typeof first.sessionRef !== "string" || typeof first.matchSource !== "string") {
    return null;
  }
  const matchSeq = typeof first.matchSeq === "number" ? first.matchSeq : null;
  return {
    sourceId: first.sourceId,
    sessionRef: first.sessionRef,
    matchSource: first.matchSource,
    matchSeq,
  };
}

async function measureReadRange(hit: TopHitRecord): Promise<ReadProbeRecord | null> {
  if (hit.matchSeq === null) return null;
  const cmd = cliCommand(
    "read-range",
    hit.sessionRef,
    "--source",
    args.source,
    "--seq",
    String(hit.matchSeq),
    "--before",
    "2",
    "--after",
    "2",
    "--db",
    args.db,
    "--json",
  );
  const { latency, payload } = await benchJsonCommand<ReadJsonPayload>(cmd, args.readRunsPerProbe);
  return {
    kind: "read-range",
    sourceId: hit.sourceId,
    sessionRef: hit.sessionRef,
    argv: publicArgv(cmd),
    messagesReturned: Array.isArray(payload.messages) ? payload.messages.length : 0,
    anchorSeq: typeof payload.anchorSeq === "number" ? payload.anchorSeq : undefined,
    ...latency,
  };
}

async function measureReadPage(hit: TopHitRecord): Promise<ReadProbeRecord> {
  const cmd = cliCommand(
    "read-page",
    hit.sessionRef,
    "--source",
    args.source,
    "--offset",
    "0",
    "--limit",
    "40",
    "--db",
    args.db,
    "--json",
  );
  const { latency, payload } = await benchJsonCommand<ReadJsonPayload>(cmd, args.readRunsPerProbe);
  return {
    kind: "read-page",
    sourceId: hit.sourceId,
    sessionRef: hit.sessionRef,
    argv: publicArgv(cmd),
    messagesReturned: Array.isArray(payload.messages) ? payload.messages.length : 0,
    totalCount: typeof payload.totalCount === "number" ? payload.totalCount : undefined,
    ...latency,
  };
}

function coverageCostSummary(run: RunResult, payload: StatusJsonPayload): CoverageCostSummary {
  const coverageRows = Array.isArray(payload.coverage) ? payload.coverage : [];
  const freshness = countBy(coverageRows.map((row) => row.freshness ?? "unknown"));
  const staleReasons = countBy(coverageRows.map((row) => staleReasonForCoverage(row)));
  const requested = payload.requestedCoverage;
  return {
    statusMs: Number(run.ms.toFixed(2)),
    coverageCount: coverageRows.length,
    freshness,
    staleReasons,
    requestedCoverage: requested ? {
      freshness: requested.freshness ?? "unknown",
      staleReason: requested.staleReason ?? "unknown",
      sourceFileCount: requested.sourceFileCount ?? 0,
      recommendedAction: requested.recommendedAction ?? "unknown",
    } : null,
  };
}

function staleReasonForCoverage(row: NonNullable<StatusJsonPayload["coverage"]>[number]): string {
  if (row.freshness !== "stale") return "none";
  return row.sourceFileSetFingerprint && row.currentSourceFileSetFingerprint === row.sourceFileSetFingerprint
    ? "source_content_changed"
    : "source_set_changed";
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function buildMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push("# shlog 性能基准报告");
  lines.push("");
  lines.push(`- generated_at: ${r.generatedAt}`);
  lines.push(`- source: \`${r.sourceId}\``);
  lines.push(`- root: \`${r.rootDir}\``);
  lines.push(`- db: \`${r.dbPath}\``);
  lines.push(`- session_count: ${r.sessionCount}`);
  lines.push(`- message_count: ${r.messageCount}`);
  lines.push(`- sync_ms: ${r.syncMs.toFixed(1)}`);
  lines.push(`- db_size: ${fmtBytes(r.dbSizeBytes)} (${r.dbSizeBytes} bytes)`);
  lines.push(`- find_runs_per_query: ${r.runsPerQuery} (first run is warmup when runs > 1)`);
  lines.push(`- read_runs_per_probe: ${r.readRunsPerProbe} (first run is warmup when runs > 1)`);
  lines.push("");
  lines.push("## coverage and freshness cost");
  lines.push("");
  lines.push(`- status_ms: ${r.coverage.statusMs.toFixed(1)}`);
  lines.push(`- coverage_count: ${r.coverage.coverageCount}`);
  lines.push(`- freshness: \`${JSON.stringify(r.coverage.freshness)}\``);
  lines.push(`- stale_reasons: \`${JSON.stringify(r.coverage.staleReasons)}\``);
  if (r.coverage.requestedCoverage) {
    lines.push(`- requested_coverage: \`${JSON.stringify(r.coverage.requestedCoverage)}\``);
  }
  lines.push("");
  lines.push("## per-query latency and raw-read probes");
  lines.push("");
  lines.push("| query | results | scanned msgs | top hit | find p50 ms | find p95 ms | read-range p95 ms | read-page p95 ms |");
  lines.push("|-------|--------:|-------------:|---------|------------:|------------:|------------------:|----------------:|");
  for (const row of r.perQuery) {
    lines.push([
      `| \`${row.query}\``,
      row.resultCount.toString(),
      row.scannedMessageCount.toString(),
      row.topHit ? `\`${row.topHit.sourceId}/${row.topHit.matchSource}\`` : "-",
      fmtMs(row.p50Ms),
      fmtMs(row.p95Ms),
      row.readRange ? fmtMs(row.readRange.p95Ms) : "-",
      `${row.readPage ? fmtMs(row.readPage.p95Ms) : "-"} |`,
    ].join(" | "));
  }
  lines.push("");
  lines.push("> 注: 小样本下 p95 取最大值作为 worst-case 近似;报告只包含计数、耗时、source/session ref 和命令参数,不包含 transcript 内容。");
  lines.push("");
  return lines.join("\n");
}
