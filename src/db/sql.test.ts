import { describe, expect, it } from "vitest";
import { selectorWhereSql } from "./sql";

describe("selectorWhereSql", () => {
  it("generates SQL conditions for valid aliases", () => {
    const selector = { kind: "all" as const, root: "/test/root" };
    const { conditions, params } = selectorWhereSql(selector, "s");
    expect(conditions).toEqual(["s.source_id = ?", "(s.file_path = ? OR s.file_path LIKE ? ESCAPE '\\')"]);
    expect(params).toEqual(["codex", "/test/root", "/test/root/%"]);
  });

  it("escapes selector roots while still allowing underscore aliases", () => {
    const selector = { kind: "cwd" as const, root: "/test/r%ot", cwd: "/tmp/project" };
    const { conditions, params } = selectorWhereSql(selector, "s_1");
    expect(conditions).toEqual([
      "s_1.source_id = ?",
      "(s_1.file_path = ? OR s_1.file_path LIKE ? ESCAPE '\\')",
      "s_1.cwd = ?",
    ]);
    expect(params).toEqual(["codex", "/test/r%ot", "/test/r\\%ot/%", "/tmp/project"]);
  });

  it("uses explicit selector source in predicates", () => {
    const selector = { source: "claude-code" as const, kind: "all" as const, root: "/test/root" };
    const { conditions, params } = selectorWhereSql(selector, "s");
    expect(conditions[0]).toBe("s.source_id = ?");
    expect(params[0]).toBe("claude-code");
  });

  it("throws an error for invalid aliases to prevent SQL injection", () => {
    const selector = { kind: "all" as const, root: "/test/root" };
    expect(() => selectorWhereSql(selector, "s; DROP TABLE users;")).toThrow("Invalid table alias");
    expect(() => selectorWhereSql(selector, "s JOIN m")).toThrow("Invalid table alias");
    expect(() => selectorWhereSql(selector, "s.m")).toThrow("Invalid table alias");
    expect(() => selectorWhereSql(selector, "1s")).toThrow("Invalid table alias");
    expect(() => selectorWhereSql(selector, '"s"')).toThrow("Invalid table alias");
    expect(() => selectorWhereSql(selector, "")).toThrow("Invalid table alias");
  });
});
