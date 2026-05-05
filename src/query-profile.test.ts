import { describe, expect, test } from "vitest";
import { classifyQueryProfile } from "./query";

describe("query profile", () => {
  test("classifies broad concept query separately from exact troubleshooting query", () => {
    expect(classifyQueryProfile("deploy").kind).toBe("broad");
    expect(classifyQueryProfile("health check 500").kind).toBe("exact");
    expect(classifyQueryProfile("src/background.ts remoteHosts").kind).toBe("exact");
  });

  describe("normalizedQuery", () => {
    test("trims whitespace and converts to lowercase", () => {
      expect(classifyQueryProfile("  Hello WORLD  ").normalizedQuery).toBe("hello world");
      expect(classifyQueryProfile("\tTest\n").normalizedQuery).toBe("test");
      expect(classifyQueryProfile("").normalizedQuery).toBe("");
    });
  });

  describe("isMultiTerm", () => {
    test("is false for single words", () => {
      expect(classifyQueryProfile("hello").isMultiTerm).toBe(false);
      expect(classifyQueryProfile("  hello  ").isMultiTerm).toBe(false); // trimmed before check
    });

    test("is true for multiple words separated by whitespace", () => {
      expect(classifyQueryProfile("hello world").isMultiTerm).toBe(true);
      expect(classifyQueryProfile("a\tb\nc").isMultiTerm).toBe(true);
    });

    test("is false for empty or pure whitespace queries", () => {
      expect(classifyQueryProfile("").isMultiTerm).toBe(false);
      expect(classifyQueryProfile("   ").isMultiTerm).toBe(false);
    });
  });

  describe("isPathLikeCommand", () => {
    test("is false for single terms even with path characters", () => {
      expect(classifyQueryProfile("src/index.ts").isPathLikeCommand).toBe(false);
      expect(classifyQueryProfile("user_id").isPathLikeCommand).toBe(false);
      expect(classifyQueryProfile("my-project").isPathLikeCommand).toBe(false);
      expect(classifyQueryProfile("module.exports").isPathLikeCommand).toBe(false);
      expect(classifyQueryProfile("http://localhost:3000").isPathLikeCommand).toBe(false);
    });

    test("is true for multiple terms with path characters", () => {
      expect(classifyQueryProfile("read src/index.ts").isPathLikeCommand).toBe(true);
      expect(classifyQueryProfile("find user_id").isPathLikeCommand).toBe(true);
      expect(classifyQueryProfile("build my-project").isPathLikeCommand).toBe(true);
      expect(classifyQueryProfile("change module.exports").isPathLikeCommand).toBe(true);
      expect(classifyQueryProfile("fetch http://localhost:3000").isPathLikeCommand).toBe(true);
    });

    test("is false for multiple terms without path characters", () => {
      expect(classifyQueryProfile("hello world").isPathLikeCommand).toBe(false);
      expect(classifyQueryProfile("what is this").isPathLikeCommand).toBe(false);
    });
  });

  describe("kind classification", () => {
    test("is 'exact' when query has multiple tokens", () => {
      expect(classifyQueryProfile("hello world").kind).toBe("exact");
    });

    test("is 'exact' when query has digits", () => {
      expect(classifyQueryProfile("error 500").kind).toBe("exact");
      expect(classifyQueryProfile("test1").kind).toBe("exact");
      expect(classifyQueryProfile("123").kind).toBe("exact");
    });

    test("is 'exact' when query has path-like characters", () => {
      expect(classifyQueryProfile("src/index.ts").kind).toBe("exact");
      expect(classifyQueryProfile("user_id").kind).toBe("exact");
      expect(classifyQueryProfile("my-project").kind).toBe("exact");
      expect(classifyQueryProfile("module.exports").kind).toBe("exact");
      expect(classifyQueryProfile("localhost:3000").kind).toBe("exact");
    });

    test("is 'broad' when query is single term, no digits, no path chars", () => {
      expect(classifyQueryProfile("deploy").kind).toBe("broad");
      expect(classifyQueryProfile("testing").kind).toBe("broad");
      expect(classifyQueryProfile("  hello  ").kind).toBe("broad");
    });

    test("is 'broad' for empty or pure whitespace queries", () => {
      expect(classifyQueryProfile("").kind).toBe("broad");
      expect(classifyQueryProfile("   ").kind).toBe("broad");
    });
  });
});
