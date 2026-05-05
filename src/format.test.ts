import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { printStats } from "./format";
import chalk from "chalk";

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
