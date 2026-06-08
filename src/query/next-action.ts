import { PROGRAM_NAME } from "../env";
import type { QueryNextAction, Selector } from "../types";

export function buildZeroResultsNextAction(
  selector: Selector | null,
  commandLabel: string,
): QueryNextAction | undefined {
  if (selector) {
    return {
      kind: "check_coverage_then_retry",
      reason: "zero_results_with_unconfirmed_selector_coverage",
      selector,
      steps: [
        `Run ${PROGRAM_NAME} status for the same selector.`,
        `If status requestedCoverage.recommendedAction is sync, run ${PROGRAM_NAME} sync for the same selector.`,
        `Retry ${commandLabel} with the same selector before concluding nothing exists.`,
      ],
    };
  }
  if (!selector) {
    return {
      kind: "choose_selector_then_check_coverage",
      reason: "zero_results_without_selector",
      steps: [
        "Choose the narrowest relevant root, cwd, or date selector.",
        `Run ${PROGRAM_NAME} status for that selector.`,
        `If status requestedCoverage.recommendedAction is sync, run ${PROGRAM_NAME} sync for that selector, then retry ${commandLabel}.`,
      ],
    };
  }
  return undefined;
}
