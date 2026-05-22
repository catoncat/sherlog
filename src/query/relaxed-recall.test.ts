import { describe, expect, test } from "vitest";
import { buildRelaxedRecallQueries } from "./relaxed-recall";

describe("buildRelaxedRecallQueries", () => {
  test("keeps technical English terms from mixed-language questions", () => {
    expect(buildRelaxedRecallQueries("最近一个星期有没有触发过 multi agent")).toEqual([
      "multi agent",
      "multi agents",
    ]);
  });

  test("expands simple dash and underscore variants", () => {
    expect(buildRelaxedRecallQueries("有没有用过 multi_agents")).toContain("multi agents");
    expect(buildRelaxedRecallQueries("有没有用过 multi-agents")).toContain("multi agent");
  });

  test("does not relax already concise English searches", () => {
    expect(buildRelaxedRecallQueries("health check")).toEqual([]);
  });
});
