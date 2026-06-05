# I3 Handoff: CLI Source Option Behavior

Thread: `019e972f-6a4a-7bb3-bd64-99b803032f85`
Status: verified; local commit and Mainline seal run after this handoff is written.
Mode: `implementation-slice`
Mainline intent: `int_0a6d76cd`

## Conclusion

Added public CLI `--source codex` behavior across the fixed command set while preserving omitted-source Codex behavior. Unsupported and non-public source values, including `claude-code`, are rejected before command work with a user-facing `unsupported_source` error. No commands were added, and no Claude Code support, release docs, `skill-packages/cxs`, push, PR, npm release, global skill update, or installed CLI update was performed.

## Actual Workspace

- cwd: `/Users/envvar/.codex/worktrees/b95e/cxs`
- repo root: `/Users/envvar/.codex/worktrees/b95e/cxs`
- initial state: detached `HEAD`
- working branch: `codex/session-sources-i3`
- starting commit: `883c5c6a0725eb3e8e0b841ff113f05a5fe23a5a`

## Files Read

- `docs/workflows/2026-06-05-session-sources/wave-map.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/D1-architecture-design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I1-codex-adapter.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I2-source-aware-storage.md`
- `docs/workflows/2026-06-05-session-sources/tasks/I3-cli-source-option.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `src/cli.ts`
- `src/status.ts`
- `src/indexer.ts`
- `src/query/find.ts`
- `src/query/search.ts`
- `src/query/list.ts`
- `src/query/read.ts`
- `src/query/stats.ts`
- `src/db/list-store.ts`
- `src/db/session-store.ts`
- `src/db/stats-store.ts`
- `src/db/coverage-store.ts`
- `src/types.ts`
- `src/cli.test.ts`

## Files Changed

- `src/cli.ts`
- `src/status.ts`
- `src/indexer.ts`
- `src/query/find.ts`
- `src/query/search.ts`
- `src/query/stats.ts`
- `src/db/list-store.ts`
- `src/types.ts`
- `src/cli.test.ts`
- `docs/workflows/2026-06-05-session-sources/handoffs/I3-cli-source-option.md`

## Implementation Summary

- Added `--source <id>` to `status`, `sync`, `find`, `read-range`, `read-page`, `list`, and `stats`.
- Kept omitted `--source` equivalent to `codex`.
- Rejected any source except `codex` with JSON shape:

```json
{
  "error": {
    "code": "unsupported_source",
    "source": "claude-code",
    "message": "unsupported source \"claude-code\". Only \"codex\" is public in this release."
  }
}
```

- Applied the same public-source gate to selector JSON `source` and read command source qualifiers.
- Passed selected source through CLI selector defaults, `syncSessions`, `collectStatus`, `findSessions`, `listSessionSummaries`, and `collectStats`.
- Added read-only `status` compatibility for old Codex indexes without `source_id`; old coverage is treated as unavailable instead of fresh source-aware coverage.

## Proof Commands And Results

- `pwd && git rev-parse --show-toplevel && (git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD) && git rev-parse HEAD && git status --short`
  - cwd/repo root: `/Users/envvar/.codex/worktrees/b95e/cxs`
  - initial branch: detached `HEAD`
  - initial commit: `883c5c6a0725eb3e8e0b841ff113f05a5fe23a5a`
  - initial status: clean
- `mainline status --json`
  - ok; repo initialized; no active intent in this worktree; unrelated uncovered/stale-proposal/AGENTS update guidance left untouched.
- `mainline context --current --json`
  - surfaced current I1/I2 workflow intents and confirmed I3 sequencing.
- `mainline context --files src/cli.ts src/status.ts src/indexer.ts src/query/find.ts src/query/read.ts src/query/list.ts src/query/stats.ts src/types.ts src/format.ts --json`
  - surfaced I1/I2 source adapter/storage decisions and unrelated efficiency-readout history; no semantic conflict found.
- `mainline start "2026-06-05-session-sources: I3 - Add CLI source option behavior" --json`
  - created `int_0a6d76cd` on branch `codex/session-sources-i3`.
- `npm ci`
  - exit 0; installed worktree dependencies; no package files changed.
- `npm run test -- src/cli.test.ts`
  - final exit 0; 1 test file passed; 27 tests passed.
- `npm run check`
  - exit 0; `tsc --noEmit` passed; 27 test files passed; 152 tests passed.
- `git diff --check`
  - exit 0.
- `npm run cxs -- status --source codex --json`
  - exit 0 against this Mac's default checkout/runtime state; reported root `/Users/envvar/.codex/sessions`, 783 source files, existing old local index counts, and no source-aware coverage.
- Temp checkout smoke with `sync/find/read-page/read-range/list/stats --source codex`
  - exit 0; summary: `syncAdded=1`, `syncSource=codex`, `findResults=1`, `pageTotal=2`, `rangeMessages=2`, `listResults=1`, `statsSessions=1`.
- `mainline preflight --json`
  - returned `block` for proposed overlaps with prior same-workflow D1/I1/I2/control-plane intents and `notes_rewrite_drift`.
  - classification: expected stacked workflow overlap, not a real semantic conflict. I3 builds on I2's source-aware storage/query contract and adds the public CLI source boundary only.

## CLI Compatibility Notes

- Fixed command names remain exactly: `status`, `sync`, `find`, `read-range`, `read-page`, `list`, `stats`.
- Existing omitted-source Codex commands remain compatible.
- Existing bare Codex UUID reads remain compatible; CLI normalizes them to the selected Codex source internally.
- `codex:<uuid>` is accepted only when it matches `--source codex`; non-public qualifiers are rejected.
- Selector JSON with missing `source` still canonicalizes to `codex`; selector JSON with `source: "claude-code"` is rejected at the CLI public boundary.

## Commit And Seal Status

- Commit status at handoff write time: pending; intended commit message `feat(cli): 增加 Codex source 选项`.
- Mainline seal status at handoff write time: pending; intent `int_0a6d76cd` has one appended turn with implementation/proof summary.
- No push, PR, release, npm publish, global skill install, or installed CLI update was performed.

## Blockers

None for I3.

## I4 Contract

- I4 can update checkout docs and `skill-packages/cxs` to describe `--source codex` as the only public source.
- I4 should state clearly that Claude Code remains reserved/non-public.
- I4 should not claim npm/global installed CLI behavior unless a separate release/install workflow runs and verifies those layers.

## Noise Events

- First focused CLI test failed before verification because `node_modules` was absent and `vitest` was not found; fixed with `npm ci`.
- Moving `program.parse()` was required after the first source-error implementation because the new class was below parse-time execution and triggered a TDZ error on error paths.
- Required checkout status smoke initially failed against this Mac's old default DB schema (`no such column: source_id`); fixed with a read-only `status` fallback instead of migrating in a read-only command.
- `mainline preflight --json` reported expected workflow overlaps and `notes_rewrite_drift`; inspected prior I1/I2 intents and classified as non-conflicting.
- `.ml-cache/mainline-signals/latest.md` was absent after preflight, so there were no local signal details to read.
- Mainline reported unrelated uncovered commits, stale proposals, and AGENTS update availability; left untouched.

## Efficiency Notes

- Parallel reads were useful for workflow files, Mainline context, and code inspection.
- Full `npm run check` took about 6 seconds after dependency install.
- Focused CLI tests caught the parse-order issue before full verification.

## Tool Fit

- `codex-session-orchestrator` fit the delegated Goal and handoff workflow.
- Mainline fit intent setup and overlap classification; reported workflow overlaps were expected and not semantic conflicts.
- Shell plus `apply_patch` fit the bounded implementation and proof loop.
