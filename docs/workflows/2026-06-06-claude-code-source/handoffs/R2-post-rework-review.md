# R2 Post-Rework Review Handoff

task_id: `R2-post-rework-review`
thread_id: `019e9c46-2e32-7683-bb63-5c1b30d35c35`
source_thread_id: `019e9b54-7344-7a51-86a8-db3d2e3db02b`
cwd: `/Users/envvar/.codex/worktrees/3004/cxs`
repo_root: `/Users/envvar/.codex/worktrees/3004/cxs`
branch: detached `HEAD`
head: `601ead68e85a05628e5dbd0b31073247d1e6650e`
reviewed_commit: `55c0638bcab28ee431b7ca70f145615e07d25f69`
status: `complete`

## Findings

No blocker found. R2 did not find any unresolved P1 that should block V1
verification.

- P1 fixed: selector/source mismatch is rejected before the Claude adapter can
  scan, snapshot, parse, write coverage, count, or prune. In
  `55c0638:src/indexer.ts:53-62`, `syncSessions()` canonicalizes the selector
  with the selected adapter's default source and calls
  `assertSelectorSourceMatches()` before entering `withSyncLock()` or calling
  `source.collectSnapshot()`. In `55c0638:src/indexer.ts:138-143`, the guard
  compares `selectorSource(selector)` to the selected `source.id`. The adapter
  snapshot path also rejects mismatched selectors in
  `55c0638:src/sources/claude-code-inventory.ts:37-40` and
  `55c0638:src/sources/claude-code-inventory.ts:57-62`.
- P1 fixed: skipped/meta/sidechain/tool/thinking/attachment records do not feed
  parser identity, cwd, timestamps, searchable text, or read projections. The
  shared policy returns `null` for `isMeta` and `isSidechain` records and accepts
  only `user` / `assistant` text in
  `55c0638:src/sources/claude-code-policy.ts:9-24` and
  `55c0638:src/sources/claude-code-policy.ts:35-47`. Parser identity and cwd
  are derived only after `acceptedClaudeRecord()` succeeds in
  `55c0638:src/sources/claude-code-parser.ts:68-81`.
- P1 fixed: skipped records do not feed inventory grouping, fingerprints, or
  coverage freshness inputs. Inventory metadata scans call
  `acceptedClaudeRecord()` before cwd/date/fingerprint updates in
  `55c0638:src/sources/claude-code-inventory.ts:99-158`; skipped-only files are
  omitted because `acceptedCount === 0` returns `null`.
- Public boundary intact: `claude-code` is registered as a private adapter, not
  a public source. `55c0638:src/sources/claude-code.ts:6-9` sets
  `public: false`; `55c0638:src/cli.ts:345-359` still accepts only `codex` via
  `publicSource()`. The C1 diff did not change `src/cli.ts`, public docs,
  skill source, package metadata, release config, or installed CLI state.
- Current-main Codex behavior appears preserved. The C1 diff does not touch
  `src/sources/codex-parser.ts`, `src/format.ts`, or `src/query/snippet.ts`.
  `git merge-base --is-ancestor b82d052e8af9d0460cf73f82e587d84b969500b9
  55c0638...` returned `0`, so C1 contains current main.
- Fixture policy appears satisfied. The committed C1 tests generate synthetic
  JSONL under temp directories in
  `55c0638:src/sources/claude-code.test.ts:265-277`. R2 found no committed real
  Claude transcript content in the touched product/test files; the only
  "real transcript" hits were C1 handoff statements asserting absence.

## W1B P1 Status

- Selector/source mismatch: fixed.
- Parser skipped-record metadata/projection risk: fixed.
- Inventory skipped-record metadata/projection risk: fixed.

## Public Boundary Status

Intact. Public CLI remains Codex-only and public docs/skill/package surfaces do
not accept or claim public Claude Code support. Residual private programmatic
adapter exposure is intentional for this gate and still needs later V1/public
promotion decisions before release.

## Real Transcript Exposure Status

Absent in reviewed C1 files. R2 did not read, copy, quote, ingest, or commit
real Claude transcript content.

## Test Adequacy

Adequate to proceed to V1. C1 added focused synthetic tests for:

- private adapter registration and public adapter filtering:
  `55c0638:src/sources/claude-code.test.ts:19-26`
- selector/source mismatch before sync/coverage writes:
  `55c0638:src/sources/claude-code.test.ts:28-54`
- parser metadata/projection filtering:
  `55c0638:src/sources/claude-code.test.ts:56-131`
- inventory grouping/date/snapshot filtering:
  `55c0638:src/sources/claude-code.test.ts:133-190`
- private sync/read isolation and default Codex isolation:
  `55c0638:src/sources/claude-code.test.ts:192-257`
- Codex remains the only public adapter:
  `55c0638:src/sources/claude-code.test.ts:259-262`

R2 did not rerun the full test suite because it was an independent
review-session and the required R2 proof was diff/readback based. C1's handoff
records `npm run check` exit 0 with 28 test files and 178 tests passing; V1
should rerun that gate fresh.

## Residual Risks

- Raw Claude JSONL remains private and experimental. C1 did not settle the
  future public SDK/session API versus raw JSONL decision.
- `sessionUuid` remains `claude-code:<nativeSessionId>`, which is collision-safe
  but not UUID-shaped for private rows.
- Inventory scans only the first 64 KiB for accepted metadata. This is
  acceptable for the private gate but should be revisited before public support.

These residual risks do not block V1. They do block any docs/skill/release claim
that Claude Code is public.

## Recommendation

Proceed to V1 verification. Do not proceed to public docs, skill source,
release, install, or global skill update from R2 alone.

## Commands And Readbacks

```text
$ pwd
/Users/envvar/.codex/worktrees/3004/cxs

$ git rev-parse --show-toplevel
/Users/envvar/.codex/worktrees/3004/cxs

$ git branch --show-current
<empty; detached HEAD>

$ git rev-parse HEAD
601ead68e85a05628e5dbd0b31073247d1e6650e

$ git status --short
<clean before writing this handoff>

$ git cat-file -e 55c0638bcab28ee431b7ca70f145615e07d25f69^{commit}
exit 0

$ git cat-file -e 601ead68e85a05628e5dbd0b31073247d1e6650e^{commit}
exit 0

$ git merge-base --is-ancestor 55c0638bcab28ee431b7ca70f145615e07d25f69 HEAD
exit 1; C1 commit exists but is not an ancestor of the controller baseline.

$ git merge-base --is-ancestor 601ead68e85a05628e5dbd0b31073247d1e6650e HEAD
exit 0

$ mainline status --json
ok; initialized; branch HEAD; local_head 601ead68; 5 uncovered main commits noted; no lifecycle mutation performed.

$ mainline context --current --json
ok; returned workflow files and no directly relevant current intents.

$ mainline context --files src/indexer.ts src/sources/claude-code-inventory.ts src/sources/claude-code-parser.ts src/sources/claude-code-policy.ts src/sources/claude-code.test.ts src/sources/registry.ts src/sources/codex.test.ts --json
ok; relevant context included int_b6b9939a and source-foundation intents.

$ git status --short && git diff --stat && git diff -- src/ test/ docs/ skill-packages/ package.json package-lock.json pnpm-lock.yaml 2>/dev/null || true
exit 0; no output before writing this handoff.

$ git diff --stat 55c0638bcab28ee431b7ca70f145615e07d25f69^ 55c0638bcab28ee431b7ca70f145615e07d25f69
10 files changed, 876 insertions(+), 1 deletion(-).

$ git show --stat --patch --find-renames 55c0638bcab28ee431b7ca70f145615e07d25f69
reviewed C1 patch.

$ git show 55c0638bcab28ee431b7ca70f145615e07d25f69:<target files>
reviewed indexer, Claude policy/parser/inventory/adapter/tests, registry, codex test, CLI publicSource, and package metadata.

$ git diff --name-only 55c0638^ 55c0638 -- docs README.md AGENTS.md skill-packages package.json package-lock.json pnpm-lock.yaml
only docs/workflows/2026-06-06-claude-code-source/handoffs/C1-private-adapter-rework.md

$ git merge-base --is-ancestor b82d052e8af9d0460cf73f82e587d84b969500b9 55c0638bcab28ee431b7ca70f145615e07d25f69
exit 0
```

## Noise Events

- The worktree is intentionally detached at controller baseline `601ead68`,
  so C1 source line references were read from the commit object using
  `git show 55c0638:<path>`, not from the current checkout.
- `rg` over all docs at C1 commit produced many historic workflow hits for
  `claude-code`; R2 treated only public surfaces and C1-touched files as
  relevant to the public-boundary review.

## Efficiency Notes

- Used the original W1B canonical handoff only and ignored replacement W1B
  evidence.
- Kept review to required control-plane reads, C1 patch, targeted source/test
  reads, public-boundary grep, and required git readbacks.

## Tool Fit

- `codex-session-orchestrator`: fit; review-session boundary and allowed handoff
  write were clear.
- `mainline`: fit for read-only context; no start/append/seal was performed
  because R2 forbids lifecycle mutation.
- `superpowers:verification-before-completion`: fit; this handoff separates
  fresh R2 evidence from C1's reported test evidence and does not claim V1 has
  passed.
