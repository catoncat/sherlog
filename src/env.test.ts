import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacyDataDir, statsReadoutEnabled } from "./env";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("migrateLegacyDataDir", () => {
  test("moves the legacy directory to dest when dest is absent", () => {
    const base = mkdtempSync(join(tmpdir(), "shlog-mig-"));
    tempDirs.push(base);
    const legacy = join(base, "legacy");
    const dest = join(base, "state", "shlog");
    mkdirSync(legacy);
    writeFileSync(join(legacy, "index.sqlite"), "stub");

    expect(migrateLegacyDataDir(legacy, dest)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(readFileSync(join(dest, "index.sqlite"), "utf8")).toBe("stub");
  });

  test("does nothing when legacy is missing (clean install)", () => {
    const base = mkdtempSync(join(tmpdir(), "shlog-mig-"));
    tempDirs.push(base);
    const legacy = join(base, "legacy");
    const dest = join(base, "state", "shlog");

    expect(migrateLegacyDataDir(legacy, dest)).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });

  test("refuses to clobber when dest already has data", () => {
    const base = mkdtempSync(join(tmpdir(), "shlog-mig-"));
    tempDirs.push(base);
    const legacy = join(base, "legacy");
    const dest = join(base, "state", "shlog");
    mkdirSync(legacy);
    writeFileSync(join(legacy, "index.sqlite"), "old");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "index.sqlite"), "new");

    expect(migrateLegacyDataDir(legacy, dest)).toBe(false);
    // both still in place; user can decide which to keep
    expect(readFileSync(join(legacy, "index.sqlite"), "utf8")).toBe("old");
    expect(readFileSync(join(dest, "index.sqlite"), "utf8")).toBe("new");
  });

  test("no-op when legacy === dest (SHLOG_DATA_DIR / CXS_DATA_DIR points back to legacy)", () => {
    const base = mkdtempSync(join(tmpdir(), "shlog-mig-"));
    tempDirs.push(base);
    const same = join(base, "shared");
    mkdirSync(same);
    writeFileSync(join(same, "index.sqlite"), "stub");

    expect(migrateLegacyDataDir(same, same)).toBe(false);
    expect(readFileSync(join(same, "index.sqlite"), "utf8")).toBe("stub");
  });
});

describe("statsReadoutEnabled", () => {
  const original = process.env.SHLOG_STATS;
  const legacyOriginal = process.env.CXS_STATS;
  afterEach(() => {
    if (original === undefined) delete process.env.SHLOG_STATS;
    else process.env.SHLOG_STATS = original;
    if (legacyOriginal === undefined) delete process.env.CXS_STATS;
    else process.env.CXS_STATS = legacyOriginal;
  });

  test("默认(未设置)开启", () => {
    delete process.env.SHLOG_STATS;
    delete process.env.CXS_STATS;
    expect(statsReadoutEnabled()).toBe(true);
  });

  test.each(["0", "off", "false", "no", "OFF", " 0 "])("%s 关闭", (value) => {
    process.env.SHLOG_STATS = value;
    expect(statsReadoutEnabled()).toBe(false);
  });

  test.each(["1", "on", "true", ""])("%s 视为开启", (value) => {
    process.env.SHLOG_STATS = value;
    expect(statsReadoutEnabled()).toBe(true);
  });

  test("兼容旧的 CXS_STATS", () => {
    delete process.env.SHLOG_STATS;
    process.env.CXS_STATS = "off";
    expect(statsReadoutEnabled()).toBe(false);
  });
});
