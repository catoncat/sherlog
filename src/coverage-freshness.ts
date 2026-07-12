import { isCurrentIndexVersion } from "./env";
import { selectorImplies, selectorSource } from "./selector";
import type {
  CoverageInventoryStatus,
  CoverageRecord,
  RequestedCoverageStatus,
  SourceSnapshot,
} from "./types";

export function evaluateCoverageRecord(
  record: CoverageRecord,
  snapshot: SourceSnapshot,
): CoverageInventoryStatus {
  const fresh = snapshot.fingerprint === record.sourceFingerprint
    && (record.sourceFileSetFingerprint === "" || snapshot.fileSetFingerprint === record.sourceFileSetFingerprint)
    && snapshot.fileCount === record.sourceFileCount
    && isCurrentIndexVersion(record.indexVersion);
  const staleReason: CoverageInventoryStatus["staleReason"] = fresh
    ? "none"
    : record.sourceFileSetFingerprint !== "" && snapshot.fileSetFingerprint === record.sourceFileSetFingerprint
      ? "source_content_changed"
      : "source_set_changed";
  return {
    ...record,
    freshness: fresh ? "fresh" : "stale",
    staleReason,
    advisory: !fresh && isAdvisorySourceContentStale(record.selector, staleReason),
    currentSourceFingerprint: snapshot.fingerprint,
    currentSourceFileSetFingerprint: snapshot.fileSetFingerprint,
    currentSourceFileCount: snapshot.fileCount,
  };
}

export function evaluateRequestedCoverage(
  snapshot: SourceSnapshot,
  coverage: CoverageInventoryStatus[],
): RequestedCoverageStatus {
  const coveringSelectors = coverage.filter((entry) =>
    isCurrentIndexVersion(entry.indexVersion) && selectorImplies(entry.selector, snapshot.selector)
  );
  const hasFreshCovering = coveringSelectors.some((entry) => entry.freshness === "fresh");
  const freshness: RequestedCoverageStatus["freshness"] = hasFreshCovering
    ? "fresh"
    : coveringSelectors.length > 0
      ? "stale"
      : "missing";
  const staleReason = requestedCoverageStaleReason(freshness, coveringSelectors);
  return {
    requested: snapshot.selector,
    complete: freshness === "fresh",
    freshness,
    staleReason,
    sourceFingerprint: snapshot.fingerprint,
    sourceFileSetFingerprint: snapshot.fileSetFingerprint,
    sourceFileCount: snapshot.fileCount,
    coveringSelectors,
    recommendedAction: freshness === "fresh" || isAdvisorySourceContentStale(snapshot.selector, staleReason) ? "query" : "sync",
  };
}

function isAdvisorySourceContentStale(
  selector: SourceSnapshot["selector"],
  staleReason: RequestedCoverageStatus["staleReason"],
): boolean {
  return selectorSource(selector) === "codex" && staleReason === "source_content_changed";
}

function requestedCoverageStaleReason(
  freshness: RequestedCoverageStatus["freshness"],
  coveringSelectors: CoverageInventoryStatus[],
): RequestedCoverageStatus["staleReason"] {
  if (freshness === "fresh") return "none";
  if (freshness === "missing") return "missing";
  return coveringSelectors.some((entry) =>
    entry.sourceFileSetFingerprint !== "" && entry.currentSourceFileSetFingerprint === entry.sourceFileSetFingerprint
  )
    ? "source_content_changed"
    : "source_set_changed";
}
