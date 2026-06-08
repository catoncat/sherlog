# C1 Private Adapter Rework Handoff

task_id: `C1-private-adapter-rework`
thread_id: `019e9c11-bf21-7921-8128-9123ef439c61`
cwd: `/Users/envvar/.codex/worktrees/35c5/cxs`
branch: `codex/claude-code-source-C1`
head: `bfdefa89590bb3dcb709b25221c68860b804fe8b`
commit: `pending-local-commit-after-gates`
status: `implemented-verified-ready-for-local-commit`

## Summary

- code_changes: reimplemented the private `claude-code` source adapter from the useful `1a080b1` material, registered it as `public: false`, added shared allowlist filtering for parser/inventory, and added a sync-time selector/source match guard.
- test_changes: added focused synthetic-fixture tests in `src/sources/claude-code.test.ts` and adjusted the Codex registry test to assert only public adapters, not all registered adapters.
- public_boundary: public CLI path is unchanged; `publicSource()` still accepts only `codex`, and smokes prove `--source claude-code` plus selector JSON `source: "claude-code"` return `unsupported_source`.
- synthetic_fixture_policy: all Claude tests/smokes use generated temp JSONL records only; no real Claude transcript content was read, copied, quoted, or committed.

## W1B P1 Closure

| Finding | Result | Evidence |
| --- | --- | --- |
| Selector/source mismatch before Claude inventory/sync/coverage/prune | Fixed | `src/indexer.ts` rejects canonical selector source mismatch before `withSyncLock`, snapshot, parse, coverage, count, or prune. `src/sources/claude-code-inventory.ts` also rejects mismatched selectors before inventory snapshot work. Focused test `rejects an explicit selector source mismatch before syncing or writing coverage` verifies no DB is created. |
| Parser skipped-record metadata influencing identity/cwd/timestamps/projections | Fixed | `src/sources/claude-code-policy.ts` returns accepted records only after rejecting `isMeta`/`isSidechain` and non-user/assistant/tool-only content. `src/sources/claude-code-parser.ts` derives `sessionId`, `cwd`, timestamps, summary, title, and messages only from accepted records. Focused test verifies meta/sidechain sentinel session IDs, cwd, timestamps, and text are absent. |
| Inventory skipped-record metadata influencing grouping/fingerprints/coverage freshness | Fixed | `src/sources/claude-code-inventory.ts` builds file metadata and fingerprints from accepted records only; skipped-only files are omitted from inventory/snapshot. Focused test verifies meta/sidechain cwd/date do not group, filter, or appear in snapshot metadata. |

## C1 Acceptance Checklist Evidence

| Checklist Item | Evidence |
| --- | --- |
| Worktree identity recorded | `pwd` and repo root `/Users/envvar/.codex/worktrees/35c5/cxs`; branch `codex/claude-code-source-C1`; pre-commit HEAD `bfdefa89590bb3dcb709b25221c68860b804fe8b`; status listed only C1 files. |
| Latest-main basis confirmed | `git merge-base --is-ancestor b82d052e8af9d0460cf73f82e587d84b969500b9 HEAD` returned `0`; current HEAD includes latest main plus controller workflow commits. |
| Selector/source mismatch fixed | Focused unit test and sync guard in `src/indexer.ts`; adapter snapshot guard in `src/sources/claude-code-inventory.ts`. |
| Parser skipped-record metadata fixed | Focused parser test shows skipped/meta/sidechain-first records cannot set identity, `cwd`, timestamps, or read/search projections. |
| Inventory skipped-record metadata fixed | Focused inventory test shows skipped records cannot set grouping, date range, snapshot file metadata, fingerprint input, or coverage freshness input. |
| Search/read privacy fixed | Focused sync/read test plus private smoke show skipped sentinel strings absent from find results and read page. |
| Public CLI rejection preserved | `npm run shlog -- status --source claude-code --json` exited 1 with `unsupported_source`. |
| Public selector rejection preserved | `npm run shlog -- sync --selector '{"source":"claude-code",...}' --json` exited 1 with `unsupported_source`. |
| Codex default behavior preserved | Focused tests `src/sources/codex.test.ts`, `src/cli.test.ts`, and full `npm run check` passed. Public adapters list remains exactly `["codex"]`. |
| Current-main drift avoided | Did not touch `src/sources/codex-parser.ts`, `src/format.ts`, or `src/query/snippet.ts`; Claude summary builder uses current-main 5000-char per-message truncation pattern. |
| Synthetic fixture only | New tests and smoke create temp synthetic JSONL records under `/tmp`; no real transcript paths or content are committed. |
| Timeout changes justified | No timeout changes were added; candidate `vi.setConfig({ testTimeout: 20_000 })` changes were not replayed. |
| `npm run check` passed | Exit 0; `tsc --noEmit && vitest run`; 28 test files passed, 178 tests passed. |
| `git diff --check` passed | Exit 0; no output. |
| Final dirty scope known | Pre-commit status: C1 source/test files plus this allowed handoff only. Final post-commit status should be clean. |

## Proof Commands

Record exact command, exit status, and decisive result.

```text
$ pwd
/Users/envvar/.codex/worktrees/35c5/cxs

$ git rev-parse --show-toplevel
/Users/envvar/.codex/worktrees/35c5/cxs

$ git branch --show-current || true
codex/claude-code-source-C1

$ git rev-parse HEAD
bfdefa89590bb3dcb709b25221c68860b804fe8b

$ git status --short --untracked-files=all
M src/indexer.ts
M src/sources/codex.test.ts
M src/sources/index.ts
M src/sources/registry.ts
?? src/sources/claude-code-inventory.ts
?? src/sources/claude-code-parser.ts
?? src/sources/claude-code-policy.ts
?? src/sources/claude-code.test.ts
?? src/sources/claude-code.ts

$ npm run test -- src/sources/claude-code.test.ts
exit 0; 1 test file passed, 6 tests passed.

$ npm run test -- src/sources/claude-code.test.ts src/sources/codex.test.ts src/cli.test.ts src/selector.test.ts src/db/session-store.test.ts src/db/coverage-store.test.ts
exit 0; 6 test files passed, 47 tests passed.

$ npm run test -- src/sources/claude-code.test.ts src/cli.test.ts
exit 0; 2 test files passed, 34 tests passed.

$ npm run check
exit 0; tsc --noEmit and Vitest passed; 28 test files passed, 178 tests passed.

$ npm run shlog -- status --source claude-code --json
exit 1 by design; JSON error code unsupported_source, source claude-code, message says only codex is public.

$ npm run shlog -- sync --selector '{"source":"claude-code","kind":"all","root":"<tmp>"}' --db <tmp>/index.sqlite --json
exit 1 by design; JSON error code unsupported_source, source claude-code, message says only codex is public.

$ node --import tsx -e '<private synthetic fixture sync/read smoke>'
exit 0; added=1, errors=0, coverageWritten=true, found=["claude-code:smoke-session"], codexDefaultCount=0, messages=["private smoke needle","private smoke answer"], leaked=false.

$ git diff --check
exit 0; no output.

$ git status --short
pending final post-commit readback.
```

## Focused Tests And Smokes

- selector/source mismatch test: `src/sources/claude-code.test.ts` / `rejects an explicit selector source mismatch before syncing or writing coverage`.
- parser skipped metadata test: `src/sources/claude-code.test.ts` / `ignores skipped records when deriving parser identity cwd timestamps and projections`.
- inventory skipped metadata test: `src/sources/claude-code.test.ts` / `ignores skipped records when deriving inventory grouping dates and snapshot file metadata`.
- public CLI `--source claude-code` rejection smoke: `npm run shlog -- status --source claude-code --json`, exit 1 with `unsupported_source`.
- public selector JSON rejection smoke: `npm run shlog -- sync --selector '{"source":"claude-code",...}' --json`, exit 1 with `unsupported_source`.
- private synthetic fixture sync/read smoke: `node --import tsx -e '<private synthetic fixture sync/read smoke>'`, exit 0 with one private Claude row indexed/read and no default Codex leakage.
- Codex default regression smoke: `npm run test -- src/sources/codex.test.ts src/cli.test.ts` and full `npm run check`.

## Files Touched

- `src/indexer.ts`
- `src/sources/claude-code-inventory.ts`
- `src/sources/claude-code-parser.ts`
- `src/sources/claude-code-policy.ts`
- `src/sources/claude-code.test.ts`
- `src/sources/claude-code.ts`
- `src/sources/codex.test.ts`
- `src/sources/index.ts`
- `src/sources/registry.ts`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/C1-private-adapter-rework.md`

## Residual Risks

- Raw Claude JSONL support remains private and experimental; no public SDK/session API decision was made in C1.
- `claude-code:<nativeSessionId>` remains intentionally source-qualified rather than UUID-shaped.
- Inventory scans only the first 64 KiB for accepted metadata, matching the candidate's lightweight private approach; future public support should revisit this with format evidence.

## Blockers

- None for C1 implementation verification.

## Follow-Up Recommendation

- Controller can reconcile C1 against `C1-acceptance-checklist.md` and launch R2/V1 only if the workflow boundary allows. Do not launch public docs/skill/release/install work from this handoff alone.

## Noise Events

- Initial focused test run failed because dependencies were not installed in this isolated worktree (`vitest: command not found`); resolved with `npm ci`.
- Controller independently observed the same TypeScript narrowing failure in `src/sources/claude-code.test.ts`; fixed by explicit `unknown` catch handling before the final `npm run check`.
- An early `git diff --stat` omitted untracked new adapter files because they had not been staged; final status/readback includes untracked files explicitly.

## Efficiency Notes

- Replayed only useful private adapter material from `1a080b1`; did not replay candidate timeout increases.
- Kept implementation inside adapter-local files plus one generic sync guard.
- Avoided public docs/skill/package changes because C1 is private/non-public.

## Tool Fit

- `codex-session-orchestrator`: fit; C1 stayed an implementation-slice worker with a compact handoff.
- `mainline`: fit; `int_98023624` tracks the C1 slice, and context confirmed the private/public boundary.
- `superpowers:using-git-worktrees`: fit; current checkout was already a linked isolated worktree, so no nested worktree was created.
- `superpowers:test-driven-development`: fit; focused Claude adapter tests failed first, then passed after implementation.
- `superpowers:verification-before-completion`: fit; completion and commit are gated on fresh focused tests, full check, CLI smokes, private smoke, diff check, and status readback.
