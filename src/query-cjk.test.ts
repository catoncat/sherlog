import { describe, it, expect } from "vitest";
import { isCjkTerm } from "./query/cjk";

describe("isCjkTerm", () => {
  it("returns true for purely CJK strings", () => {
    // Han script
    expect(isCjkTerm("汉字")).toBe(true);
    expect(isCjkTerm("漢字")).toBe(true);

    // Hiragana
    expect(isCjkTerm("ひらがな")).toBe(true);

    // Katakana
    expect(isCjkTerm("カタカナ")).toBe(true);

    // Hangul
    expect(isCjkTerm("한글")).toBe(true);

    // Mixed CJK scripts
    expect(isCjkTerm("漢字ひらがなカタカナ한글")).toBe(true);
  });

  it("returns false for non-CJK strings", () => {
    expect(isCjkTerm("hello")).toBe(false);
    expect(isCjkTerm("test")).toBe(false);
    expect(isCjkTerm("123")).toBe(false);
    expect(isCjkTerm("   ")).toBe(false);
    expect(isCjkTerm("")).toBe(false); // empty string
  });

  it("returns false for mixed CJK and non-CJK strings", () => {
    expect(isCjkTerm("hello漢字")).toBe(false);
    expect(isCjkTerm("漢字123")).toBe(false);
    expect(isCjkTerm("漢字 ")).toBe(false); // trailing space
    expect(isCjkTerm(" 漢字")).toBe(false); // leading space
  });
});
