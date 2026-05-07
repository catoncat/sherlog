import { describe, expect, it } from "vitest";
import { selectorWhereSql } from "./sql";

describe("selectorWhereSql", () => {
  it("generates SQL conditions for valid aliases", () => {
    const selector = { kind: "all" as const, root: "/test/root" };
    const { conditions, params } = selectorWhereSql(selector, "s");
    expect(conditions).toEqual(["(s.file_path = ? OR s.file_path LIKE ? ESCAPE '\\')"]);
    expect(params).toEqual(["/test/root", "/test/root/%"]);
  });

  it("throws an error for invalid aliases to prevent SQL injection", () => {
    const selector = { kind: "all" as const, root: "/test/root" };
    expect(() => selectorWhereSql(selector, "s; DROP TABLE users;")).toThrow("Invalid table alias");
    expect(() => selectorWhereSql(selector, "s JOIN m")).toThrow("Invalid table alias");
    expect(() => selectorWhereSql(selector, "s.m")).toThrow("Invalid table alias");
    expect(() => selectorWhereSql(selector, '"s"')).toThrow("Invalid table alias");
    expect(() => selectorWhereSql(selector, "")).toThrow("Invalid table alias");
  });
});
