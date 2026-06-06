# C1 Acceptance Checklist

status: `reconciled-pass`

Use this checklist when the pause is lifted, C1 has run, and the controller is
reconciling `handoffs/C1-private-adapter-rework.md`. It is not a worker launch
instruction and is not evidence by itself.

## Required Inputs

- `handoffs/C1-private-adapter-rework.md`
- C1 final message, if it contains proof not copied into the handoff
- `verification-runbook.md`
- `completion-audit.md`
- current `git status --short --untracked-files=all` in the C1 worktree

## Hard Fail Conditions

Reject C1 and do not launch R2/V1 if any item is true:

- C1 used, copied, quoted, or committed real Claude transcript content.
- Public CLI, docs, skill source, package metadata, or release notes claim
  public Claude Code support.
- `--source claude-code` is accepted by the public CLI before an explicit public
  promotion slice.
- Selector JSON requesting public `claude-code` is accepted before promotion.
- Any W1B P1 finding is unaddressed or only explained without a test/proof.
- Current-main Codex behavior, parser truncation, snippet, or format behavior
  regressed.
- Product changes exist outside C1's intended private adapter/test scope without
  explanation.
- Required proof commands did not run and no acceptable blocker is recorded.

## Review Items

Mark each item `pass`, `fail`, or `unknown` while reconciling C1.

| Item | Expected Evidence | Result |
| --- | --- | --- |
| Worktree identity recorded | `pwd`, repo root, branch/detached, HEAD, `git status --short` in handoff | pass: handoff records `/Users/envvar/.codex/worktrees/35c5/cxs`, branch `codex/claude-code-source-C1`, pre-commit HEAD `bfdefa8`, and scoped dirty files; controller readback sees commit `55c0638`. |
| Latest-main basis confirmed | C1 states whether it started from `b82d052e8af9d0460cf73f82e587d84b969500b9` or explains rebase/cherry-pick basis | pass: handoff records `git merge-base --is-ancestor b82d052e8af9d0460cf73f82e587d84b969500b9 HEAD` returned 0. |
| Selector/source mismatch fixed | focused test and code summary show mismatch rejected before Claude inventory/snapshot/sync/coverage/count/prune | pass: `src/indexer.ts` guard and `src/sources/claude-code-inventory.ts` guard are covered by focused mismatch test. |
| Parser skipped-record metadata fixed | focused test shows skipped/meta/sidechain-first records cannot set session identity, `cwd`, timestamps, or read projections | pass: parser test uses meta/sidechain sentinel IDs, cwd, timestamps, and text and verifies they are absent. |
| Inventory skipped-record metadata fixed | focused test shows skipped/meta/sidechain records cannot set inventory grouping, fingerprints, or coverage freshness | pass: inventory test verifies accepted-only cwd/date/snapshot metadata and skipped-only cwd gets zero files. |
| Search/read privacy fixed | synthetic sentinel strings from skipped records absent from searchable/read projections | pass: private sync/read test and smoke verify skipped sentinel strings are absent from find/read projections. |
| Public CLI rejection preserved | CLI smoke and tests show `--source claude-code` rejected | pass: `npm run cxs -- status --source claude-code --json` exited 1 with `unsupported_source`. |
| Public selector rejection preserved | CLI smoke and tests show selector JSON requesting `claude-code` rejected | pass: `npm run cxs -- sync --selector '{"source":"claude-code",...}' --json` exited 1 with `unsupported_source`. |
| Codex default behavior preserved | focused regression test or smoke for default Codex path | pass: focused `src/sources/codex.test.ts` / `src/cli.test.ts` and full `npm run check` passed; public adapters remain exactly `["codex"]`. |
| Current-main drift avoided | C1 identifies preservation of parser truncation and snippet/format fixes | pass: handoff states `src/sources/codex-parser.ts`, `src/format.ts`, and `src/query/snippet.ts` were untouched; controller diff review confirmed. |
| Synthetic fixture only | C1 describes fixture source and confirms no real transcript content | pass: tests and smoke create temp synthetic JSONL under `/tmp`; no real transcript fixture/content appears in touched files. |
| Timeout changes justified | C1 explains no timeout changes or gives evidence for scoped changes | pass: no timeout changes were replayed from `1a080b1`. |
| `npm run check` passed | command and decisive result in handoff | pass: handoff records exit 0, 28 test files and 178 tests passed. |
| `git diff --check` passed | command and decisive result in handoff | pass: handoff records exit 0 with no output. |
| Final dirty scope known | final `git status --short` in handoff | pass: worker committed local implementation as `55c0638`; controller readback shows clean C1 worktree after commit. |

## Controller Decision

After filling the table:

- If every hard fail condition is absent and all review items are `pass`, record
  C1 as `reconciled` in `session-registry.md`, update `completion-audit.md`, and
  launch R2 only if the user boundary allows new workers.
- If any item is `fail`, keep C1 open or launch a follow-up fix slice only after
  the user boundary allows workers.
- If any item is `unknown`, collect the missing proof from the C1 thread/handoff
  before deciding.

Do not treat C1 as full-goal completion. Even a passing C1 only unlocks R2.

## Controller Reconciliation

- decision: C1 accepted for the private-adapter rework gate.
- accepted_commit: `55c0638`
- accepted_handoff: `handoffs/C1-private-adapter-rework.md`
- next_gate: R2 post-rework review.
- full_goal_status: incomplete; docs, skill source, lifecycle, release, install,
  and global skill state are not proven.
