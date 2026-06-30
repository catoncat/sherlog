import { describe, expect, test } from "vitest";
import { buildQuerySignals } from "./query";

describe("query signals", () => {
  describe("normalizedQuery", () => {
    test("trims whitespace and converts to lowercase", () => {
      expect(buildQuerySignals("  Hello WORLD  ").normalizedQuery).toBe("hello world");
      expect(buildQuerySignals("\tTest\n").normalizedQuery).toBe("test");
      expect(buildQuerySignals("").normalizedQuery).toBe("");
    });
  });

  describe("isMultiTerm", () => {
    test("is false for single words", () => {
      expect(buildQuerySignals("hello").isMultiTerm).toBe(false);
      expect(buildQuerySignals("  hello  ").isMultiTerm).toBe(false); // trimmed before check
    });

    test("is true for multiple words separated by whitespace", () => {
      expect(buildQuerySignals("hello world").isMultiTerm).toBe(true);
      expect(buildQuerySignals("a\tb\nc").isMultiTerm).toBe(true);
    });

    test("is false for empty or pure whitespace queries", () => {
      expect(buildQuerySignals("").isMultiTerm).toBe(false);
      expect(buildQuerySignals("   ").isMultiTerm).toBe(false);
    });
  });

  describe("isPathLikeCommand", () => {
    test("is false for single terms even with path characters", () => {
      expect(buildQuerySignals("src/index.ts").isPathLikeCommand).toBe(false);
      expect(buildQuerySignals("user_id").isPathLikeCommand).toBe(false);
      expect(buildQuerySignals("my-project").isPathLikeCommand).toBe(false);
      expect(buildQuerySignals("module.exports").isPathLikeCommand).toBe(false);
      expect(buildQuerySignals("http://localhost:3000").isPathLikeCommand).toBe(false);
    });

    test("is true for multiple terms with path characters", () => {
      expect(buildQuerySignals("read src/index.ts").isPathLikeCommand).toBe(true);
      expect(buildQuerySignals("find user_id").isPathLikeCommand).toBe(true);
      expect(buildQuerySignals("build my-project").isPathLikeCommand).toBe(true);
      expect(buildQuerySignals("change module.exports").isPathLikeCommand).toBe(true);
      expect(buildQuerySignals("fetch http://localhost:3000").isPathLikeCommand).toBe(true);
    });

    test("is false for multiple terms without path characters", () => {
      expect(buildQuerySignals("hello world").isPathLikeCommand).toBe(false);
      expect(buildQuerySignals("what is this").isPathLikeCommand).toBe(false);
    });
  });
});
