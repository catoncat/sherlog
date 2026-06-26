import { PROGRAM_NAME } from "./env";
import type { FindResult, SessionSourceId } from "./types";

const DEFAULT_READ_RANGE_BEFORE = 2;
const DEFAULT_READ_RANGE_AFTER = 2;
const DEFAULT_SESSION_PAGE_OFFSET = 0;
const DEFAULT_SESSION_PAGE_LIMIT = 40;

export type EvidenceReadAction =
  | {
      kind: "read-range";
      reason: "message_match";
      sourceId: SessionSourceId;
      sessionRef: string;
      seq: number;
      before: number;
      after: number;
      argv: string[];
    }
  | {
      kind: "read-page";
      reason: "session_level_match";
      sourceId: SessionSourceId;
      sessionRef: string;
      offset: number;
      limit: number;
      argv: string[];
    };

export function buildEvidenceReadAction(result: Pick<FindResult, "sourceId" | "sessionRef" | "matchSeq">): EvidenceReadAction {
  if (result.matchSeq === null) {
    return {
      kind: "read-page",
      reason: "session_level_match",
      sourceId: result.sourceId,
      sessionRef: result.sessionRef,
      offset: DEFAULT_SESSION_PAGE_OFFSET,
      limit: DEFAULT_SESSION_PAGE_LIMIT,
      argv: [
        PROGRAM_NAME,
        "read-page",
        result.sessionRef,
        "--offset",
        String(DEFAULT_SESSION_PAGE_OFFSET),
        "--limit",
        String(DEFAULT_SESSION_PAGE_LIMIT),
      ],
    };
  }

  return {
    kind: "read-range",
    reason: "message_match",
    sourceId: result.sourceId,
    sessionRef: result.sessionRef,
    seq: result.matchSeq,
    before: DEFAULT_READ_RANGE_BEFORE,
    after: DEFAULT_READ_RANGE_AFTER,
    argv: [
      PROGRAM_NAME,
      "read-range",
      result.sessionRef,
      "--seq",
      String(result.matchSeq),
      "--before",
      String(DEFAULT_READ_RANGE_BEFORE),
      "--after",
      String(DEFAULT_READ_RANGE_AFTER),
    ],
  };
}
