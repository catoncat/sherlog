# I1 Handoff: Codex Source Adapter

Thread: `019e9711-5a26-7530-bc95-40a38cd49061`
Status: completed
Mode: `implementation-slice`

## Conclusion

Extracted Codex source discovery and parsing behind a source adapter boundary while preserving current Codex behavior and the existing public module import surfaces.

## Actual Workspace

- cwd: `/Users/envvar/.codex/worktrees/b3c6/cxs`
- repo root: `/Users/envvar/.codex/worktrees/b3c6/cxs`
- branch: detached `HEAD`
- starting commit: `1159dcdbceec31c295f248d6ab826eaf1909cb18`
- Mainline intent: `int_6bfea808`

## Files Read

- `docs/workflows/2026-06-05-session-sources/wave-map.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/D1-architecture-design.md`
- `docs/workflows/2026-06-05-session-sources/tasks/I1-codex-adapter.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `src/env.ts`
- `src/parser.ts`
- `src/source-inventory.ts`
- `src/indexer.ts`
- `src/status.ts`
- `src/types.ts`
- `src/parser.test.ts`
- `src/source-inventory.test.ts`
- `src/indexer.test.ts`
- `src/status.test.ts`
- `src/env.test.ts`

## Files Changed

- `src/sources/types.ts`
- `src/sources/codex-parser.ts`
- `src/sources/codex-inventory.ts`
- `src/sources/codex.ts`
- `src/sources/registry.ts`
- `src/sources/index.ts`
- `src/sources/codex.test.ts`
- `src/parser.ts`
- `src/source-inventory.ts`
- `src/indexer.ts`
- `src/status.ts`
- `docs/workflows/2026-06-05-session-sources/handoffs/I1-codex-adapter.md`

## Implementation Summary

- Added `SessionSourceAdapter`, `SessionSourceId`, and `SourceSnapshotOptions` in `src/sources/types.ts`.
- Registered only the public `codex` adapter in `src/sources/registry.ts`; no Claude Code adapter implementation was added.
- Moved existing Codex JSONL parser implementation to `src/sources/codex-parser.ts`.
- Moved existing Codex inventory/snapshot/file walking implementation to `src/sources/codex-inventory.ts`.
- Kept `src/parser.ts` and `src/source-inventory.ts` as compatibility facades, so existing imports and tests continue to work.
- Routed `syncSessions()` through the Codex adapter for default root resolution, strict snapshots, and parsing.
- Routed `collectStatus()` through the Codex adapter for default root resolution, inventory, and coverage freshness snapshots.
- Added `src/sources/codex.test.ts` to prove registry/default adapter behavior plus root/inventory/snapshot/parse integration.

## Proof Commands And Results

- `pwd && git rev-parse --show-toplevel && git branch --show-current || true && git rev-parse HEAD && git status --short`
  - cwd/repo root: `/Users/envvar/.codex/worktrees/b3c6/cxs`
  - branch: detached `HEAD`
  - commit: `1159dcdbceec31c295f248d6ab826eaf1909cb18`
  - initial status: clean
- `mainline status --json`
  - ok; repo initialized; detached `HEAD`; no active intent before I1; unrelated uncovered/stale-proposal guidance left untouched.
- `mainline context --current --json`
  - confirmed workflow design state and I1 sequencing.
- `mainline context --files src/env.ts src/parser.ts src/source-inventory.ts src/indexer.ts src/status.ts --json`
  - surfaced prior source-inventory and strict-sync decisions; preserved strict missing-root and cwd-metadata behavior.
- `npm ci`
  - exit 0; installed worktree dependencies from lockfile; no package files changed.
- `npm run test -- src/parser.test.ts src/source-inventory.test.ts src/sources/codex.test.ts src/indexer.test.ts src/status.test.ts`
  - exit 0; 5 test files passed, 25 tests passed.
- `npm run check`
  - exit 0; `tsc --noEmit` passed; 27 test files passed, 143 tests passed.
- `git diff --check`
  - exit 0.
- Checkout CLI smoke with temp Codex root:
  - `npm run --silent cxs -- status --root <tmp>/sessions --json`
  - `npm run --silent cxs -- sync --root <tmp>/sessions --db <tmp>/index.sqlite --json`
  - `npm run --silent cxs -- find "i1 adapter smoke" --db <tmp>/index.sqlite --json`
  - result: `statusTotalFiles=1`, `syncAdded=1`, `syncErrors=0`, `findResults=1`, `firstSession=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.

## Blockers

None for I1.

## Implementation Contract For I2/I3

- I2 can keep using the new adapter boundary but must add source-aware selector, coverage, DB identity, migration/backfill, query/read/delete/replace, and FTS safety itself. I1 intentionally did not change DB schema, selector shape, coverage semantics, or index version.
- I2 should decide when canonical parsed sessions gain `sourceId`, `nativeSessionId`, and `sessionKey`; I1 preserves the current `ParsedSession.sessionUuid` shape to avoid pre-empting storage work.
- I3 can wire CLI `--source codex` to `getSessionSourceAdapter("codex")`; unsupported/non-public source errors are not public behavior yet.
- `src/parser.ts` and `src/source-inventory.ts` remain compatibility facades. I2/I3 may replace internal callers gradually, but external current tests still expect these exports.
- The registry currently exposes only `codex`; `claude-code` is reserved in the type union but has no adapter and is not advertised or callable.

## Noise Events

- First `npm run check -- --runInBand` failed before code verification because `node_modules` was absent and `tsc` was not installed. Resolved with `npm ci`.
- First CLI smoke attempted to parse stdout from non-silent `npm run cxs`; npm's script banner polluted JSON. Re-ran with `npm run --silent cxs -- ...` and passed.
- `rg --files src test tests` reported missing `test` and `tests` directories; useful result still identified relevant `src/*.test.ts` files.
- Mainline reported unrelated uncovered commits, stale proposals, and AGENTS update availability; left untouched because they are outside I1.

## Efficiency Notes

- Used parallel reads for workflow, Mainline context, source files, and focused tests.
- Kept implementation bounded to `src/sources`, existing Codex parser/inventory callers, `indexer/status`, one focused adapter test, and this handoff.
- `npm ci` cost about 9 seconds and full `npm run check` cost about 5 seconds after dependency install.

## Tool Fit

- `codex-session-orchestrator` fit the delegated goal/handoff workflow.
- Mainline fit intent setup and historical boundary checks.
- Shell plus `apply_patch` fit the small refactor; no browser, release, global install, push, PR, or Claude tooling was needed.
