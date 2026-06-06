# W1B Private Adapter Review

task_id: W1B-private-adapter-review
thread_id: 019e9b58-31fd-7b00-9c7d-c6085e9cf25c
cwd: /Users/envvar/.codex/worktrees/eaa1/cxs
branch: detached HEAD
head: 783e17a658b562e6c550ecb1d018fef738e9bf7f
status: complete

## Findings

- P1 source/selector integrity hole: `1a080b1:src/sources/claude-code-inventory.ts:32-35` canonicalizes selectors with `defaultSource: "claude-code"` but does not reject an explicit mismatched selector source. A programmatic `syncSessions({ sourceId: "claude-code", selector: { source: "codex", ... } })` can scan/parse Claude files while downstream coverage/count/prune use `selectorSource(selector)` as Codex in `1a080b1:src/indexer.ts:56-64` and `1a080b1:src/indexer.ts:231-240`. CLI blocks this path, but the private adapter is programmatic, so the source match still needs to be enforced before snapshot/sync.
- P1 skipped-record metadata/projection risk: `1a080b1:src/sources/claude-code-parser.ts:67-70` extracts `sessionId` and `cwd` before skipping `isMeta` / `isSidechain`. These skipped records are not searchable message text, but they can still influence `nativeSessionId`, `sessionKey`, `sessionUuid`, session `cwd`, and read/session metadata projections.
- P1 inventory metadata/projection risk: `1a080b1:src/sources/claude-code-inventory.ts:101-112` extracts `cwd` and `timestamp` from any early record containing those fields before applying privacy class decisions. Meta, sidechain, diagnostics, or other private structural records can therefore influence source inventory, selector filtering, source fingerprints, coverage freshness, and scoped sync.
- P2 public CLI boundary is intact in this candidate: `1a080b1:src/cli.ts:355-359` only accepts public source `codex`, and `1a080b1:src/cli.test.ts:325-360` covers `--source claude-code` and selector JSON rejection. The risk is internal/programmatic exposure, not advertised CLI support.
- P2 raw Claude JSONL stability risk: `1a080b1:src/sources/claude-code-parser.ts:72-97` assumes useful Claude records have top-level `type: "user" | "assistant"` plus top-level `content` or `message.content`, and top-level `sessionId` / `cwd`. Keep this private until fresh format evidence or an SDK/session API decision exists.
- P2 test adequacy / timeout risk: `1a080b1:src/sources/claude-code.test.ts:54-149` tests negative text leakage for tool/thinking/attachment/parentUuid/meta/sidechain content, but misses selector-source mismatch and meta/sidechain-first metadata extraction. `1a080b1:src/cli.test.ts:14` and `1a080b1:src/query-concurrency.test.ts:9` raise per-file timeout to 20s; that may be reasonable, but should remain local to known slow integration tests and not mask new slowness.
- P2 current-main drift: current main `b82d052` includes later parser truncation/performance changes in `src/sources/codex-parser.ts` that are absent from `1a080b1`. Any rebase/cherry-pick must preserve main's summary truncation changes, along with later `src/format.ts` and `src/query/snippet.ts` performance fixes.

## Open Questions

- Should the private adapter be registered for programmatic sync before source/selector matching is enforced?
- Should Claude inventory derive `cwd` / timestamp only from accepted non-meta, non-sidechain user/assistant records, or from a separately trusted session metadata record?
- For future public support, should raw JSONL remain experimental while SDK/session API is evaluated as the public ingestion route?

## Residual Risks

- Programmatic `sourceId: "claude-code"` expands the internal write surface even though public CLI remains Codex-only.
- Claude `sessionUuid` is set to `claude-code:<nativeSessionId>`; this is collision-safe but not UUID-shaped for any internal caller reading private rows.
- No docs, skill, package, release, or install files changed in `1a080b1`, so docs/skill/release overclaim risk is low for the candidate itself. Future closeout still must separate source checkout, skill source, npm registry CLI, and installed PATH CLI.

## Recommendation

Do not promote or merge `1a080b1` as-is. Treat it as a private spike and launch a narrow rework slice that enforces source/selector matching, moves metadata extraction behind privacy skip/allowlist rules, adds negative tests for selector mismatch plus meta/sidechain metadata ordering, and rebases onto current main `b82d052` while preserving current-main parser truncation and snippet/format performance fixes.

## Proof Commands

- `pwd && git rev-parse --show-toplevel && git branch --show-current || true && git rev-parse HEAD && git status --short`
- `git symbolic-ref --short -q HEAD || printf 'detached HEAD\n'`
- `mainline preflight --json`
- `mainline status --json`
- `mainline show int_b6b9939a --json`
- `git rev-list --parents -n 1 1a080b1abf8e75dd9ecba607af4dca7c7141b3fb`
- `git show --stat --oneline --decorate --name-status 1a080b1abf8e75dd9ecba607af4dca7c7141b3fb`
- `git merge-base 1a080b1abf8e75dd9ecba607af4dca7c7141b3fb b82d052e8af9d0460cf73f82e587d84b969500b9`
- `git diff --name-status 1a080b1abf8e75dd9ecba607af4dca7c7141b3fb b82d052e8af9d0460cf73f82e587d84b969500b9`
- Targeted `git show` / `git diff` reads for candidate parser, inventory, registry, CLI tests, query/read paths, and current-main drift.
- Sidecar proof reported: `git diff --check 24a8f46..1a080b1` had no output, and `git merge-tree b82d052 1a080b1` produced a clean tree hash only.

## Blockers

- None for W1B. No implementation or product tests were run because this was a read-only review-session and controller requested immediate closeout.

## noise_events

- Sidecar review timed out during active closeout but completed immediately after the first handoff write; its source/selector mismatch finding was incorporated.
- One branch readback command used unsupported `git describe --detach`; corrected with `git symbolic-ref --short -q HEAD || printf 'detached HEAD\n'`.

## efficiency_notes

- Stopped expansion after controller correction and wrote only the allowed handoff.
- Did not read real Claude transcript content or committed private fixtures.

## tool_fit

- `codex-session-orchestrator`: fit; review-session boundary and handoff shape were directly applicable.
- `mainline`: fit; read-only `preflight/status/show` gave proposed intent and current-main context without lifecycle mutation.
- `superpowers:verification-before-completion`: fit; claims are limited to fresh read-only proof.
- `superpowers:requesting-code-review`: fit; sidecar review contributed the source/selector mismatch finding, then main thread incorporated it.

## do_not_read_transcript_unless

- Handoff contradicts code/diff evidence.
- Controller needs process forensics for why `1a080b1` was proposed despite metadata/projection leakage.
- A later worker cannot reproduce cited parser/inventory behavior from the commit object.
