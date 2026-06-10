import { describe, expect, test } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  test("runs work with a fixed concurrency cap while preserving result order", async () => {
    let active = 0;
    let maxActive = 0;
    const releaseNext: Array<() => void> = [];

    const resultsPromise = mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releaseNext.push(resolve));
      active -= 1;
      return value * 10;
    });

    while (releaseNext.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(active).toBe(2);
    expect(maxActive).toBe(2);

    while (releaseNext.length > 0) {
      releaseNext.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await expect(resultsPromise).resolves.toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBe(2);
  });
});
