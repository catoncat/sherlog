import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { printFindResults, printReadPage, printReadRangeResult, printStats } from "./format";
import type { FindResult, MessageRecord, SessionRecord } from "./types";
import chalk from "chalk";

const stripAnsi = (value: string): string => value.replace(/\[[0-9;]*m/g, "");

function captured(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args: unknown[]) => stripAnsi(args.map(String).join(" "))).join("\n");
}

function makeFindResult(overrides: Partial<FindResult> = {}): FindResult {
  return {
    rank: 1,
    sessionUuid: "11111111-1111-4111-8111-111111111111",
    title: "排查 deploy",
    summaryText: "",
    cwd: "/tmp/project-a",
    startedAt: "2026-04-21T10:00:00.000Z",
    endedAt: "2026-04-21T10:30:00.000Z",
    matchCount: 1,
    matchSource: "message",
    matchSeq: 2,
    matchRole: "user",
    matchTimestamp: "2026-04-21T10:05:00.000Z",
    score: -1,
    snippet: "health check 还是 500",
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionUuid: "11111111-1111-4111-8111-111111111111",
    filePath: "/root/sessions/x.jsonl",
    sourceRoot: "/root/sessions",
    title: "排查 deploy",
    summaryText: "",
    cwd: "/tmp/project-a",
    model: "gpt-5.4",
    startedAt: "2026-04-21T10:00:00.000Z",
    endedAt: "2026-04-21T10:30:00.000Z",
    pathDate: "2026-04-21",
    messageCount: 100,
    ...overrides,
  };
}

function makeMessage(seq: number): MessageRecord {
  return {
    sessionUuid: "11111111-1111-4111-8111-111111111111",
    seq,
    role: seq % 2 === 0 ? "assistant" : "user",
    contentText: `msg ${seq}`,
    timestamp: "2026-04-21T10:05:00.000Z",
    sourceKind: "event_msg",
  };
}

describe("printStats", () => {
  let consoleLogSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("prints basic stats without topCwds", () => {
    printStats({
      sessionCount: 10,
      messageCount: 50,
      earliestStartedAt: "2023-01-01",
      latestEndedAt: "2023-12-31",
      lastSyncAt: "2024-01-01",
      indexVersion: "v1",
      dbPath: "/path/to/db",
      dbSizeBytes: 1024,
      coverage: [],
      topCwds: [],
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(chalk.bold.cyan("cxs stats"));
    expect(consoleLogSpy).toHaveBeenCalledWith("sessions:        10");
    expect(consoleLogSpy).toHaveBeenCalledWith("messages:        50");
    expect(consoleLogSpy).toHaveBeenCalledWith("earliest:        2023-01-01");
    expect(consoleLogSpy).toHaveBeenCalledWith("latest:          2023-12-31");
    expect(consoleLogSpy).toHaveBeenCalledWith("last_sync_at:    2024-01-01");
    expect(consoleLogSpy).toHaveBeenCalledWith("index_version:   v1");
    expect(consoleLogSpy).toHaveBeenCalledWith("db_path:         /path/to/db");
    expect(consoleLogSpy).toHaveBeenCalledWith("db_size_bytes:   1024");
    expect(consoleLogSpy).toHaveBeenCalledWith("coverage_count:  0");
    // Verify top cwds was not printed
    expect(consoleLogSpy).not.toHaveBeenCalledWith(chalk.bold("top cwds"));
  });

  test("handles null date fields", () => {
    printStats({
      sessionCount: 0,
      messageCount: 0,
      earliestStartedAt: null,
      latestEndedAt: null,
      lastSyncAt: null,
      indexVersion: "v1",
      dbPath: "/path/to/db",
      dbSizeBytes: 0,
      coverage: [],
      topCwds: [],
    });

    expect(consoleLogSpy).toHaveBeenCalledWith("earliest:        -");
    expect(consoleLogSpy).toHaveBeenCalledWith("latest:          -");
    expect(consoleLogSpy).toHaveBeenCalledWith("last_sync_at:    -");
  });

  test("prints top cwds with proper padding", () => {
    printStats({
      sessionCount: 10,
      messageCount: 50,
      earliestStartedAt: "2023-01-01",
      latestEndedAt: "2023-12-31",
      lastSyncAt: "2024-01-01",
      indexVersion: "v1",
      dbPath: "/path/to/db",
      dbSizeBytes: 1024,
      coverage: [],
      topCwds: [
        { cwd: "/short", count: 5 },
        { cwd: "/a/much/longer/path", count: 15 },
      ],
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(); // Empty line before top cwds
    expect(consoleLogSpy).toHaveBeenCalledWith(chalk.bold("top cwds"));
    // The width should be the length of the longest cwd (20 characters for "/a/much/longer/path")
    expect(consoleLogSpy).toHaveBeenCalledWith(`  /short               5`);
    expect(consoleLogSpy).toHaveBeenCalledWith(`  /a/much/longer/path  15`);
  });
});

describe("效率回述", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("find header 报检索语料规模(千分位)、结果数、端到端 ms", () => {
    printFindResults("health check", [makeFindResult()], 1234, 87);
    const out = captured(consoleLogSpy);
    expect(out).toContain("检索 1,234 条");
    expect(out).toContain("结果 1");
    expect(out).toContain("87ms");
  });

  test("find 零结果仍诚实报检索规模与耗时,不报省", () => {
    printFindResults("nonexistent", [], 5000, 40);
    const out = captured(consoleLogSpy);
    expect(out).toContain("检索 5,000 条");
    expect(out).toContain("结果 0");
    expect(out).toContain("40ms");
    expect(out).toContain("没有找到结果");
    expect(out).not.toContain("省");
  });

  test("read-range 只报读取/全量计数与 ms,绝不出现 saved%", () => {
    printReadRangeResult(makeSession(), 2, [makeMessage(1), makeMessage(2), makeMessage(3)], 1, 3, 12);
    const out = captured(consoleLogSpy);
    expect(out).toContain("读取 3 条 / 本 session 共 100 条 · 12ms");
    expect(out).not.toContain("省");
    expect(out).not.toContain("saved");
    expect(out).not.toContain("%");
  });

  test("read-page meta 行追加端到端 ms,保留 total/hasMore", () => {
    printReadPage(makeSession(), 0, 20, 100, true, [makeMessage(1)], 8);
    const out = captured(consoleLogSpy);
    expect(out).toContain("total=100");
    expect(out).toContain("hasMore=true");
    expect(out).toContain("8ms");
  });
});
