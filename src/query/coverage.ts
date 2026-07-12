import { coverageStatusForSelector } from "../db";
import type { CoverageStatus, Selector } from "../types";
import type { Db } from "../db";

export function buildCoverageStatus(db: Db, selector: Selector | null): CoverageStatus {
  const status = coverageStatusForSelector(db, selector);
  return {
    requested: selector,
    complete: false,
    freshness: "not_checked",
    coveringSelectors: status.coveringSelectors,
  };
}
