import { describe, expect, test } from "vitest";
import { queryTerms } from "./tokenize";

describe("queryTerms", () => {
  test("handles empty string", () => {
    expect(queryTerms("")).toEqual([]);
  });

  test("extracts single word", () => {
    expect(queryTerms("hello")).toEqual(["hello"]);
  });

  test("lowercases words and removes duplicates", () => {
    expect(queryTerms("Hello hello HELLO")).toEqual(["hello"]);
  });

  test("handles multiple distinct words", () => {
    expect(queryTerms("foo bar baz")).toEqual(["foo", "bar", "baz"]);
  });

  test("removes duplicates across multiple words", () => {
    expect(queryTerms("foo bar foo baz bar")).toEqual(["foo", "bar", "baz"]);
  });

  test("handles CJK text with overlapping bigrams and deduplication", () => {
    // "测试测试" -> ["测试", "试测", "测试"] -> distinct: ["测试", "试测"]
    expect(queryTerms("测试测试")).toEqual(["测试", "试测"]);
  });

  test("handles mixed CJK and English", () => {
    expect(queryTerms("hello 测试 world 测试")).toEqual(["hello", "测试", "world"]);
  });

  test("ignores punctuation", () => {
    expect(queryTerms("hello, world! hello.")).toEqual(["hello", "world"]);
  });
});
