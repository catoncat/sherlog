# C1 Private Adapter Rework

Mode: `implementation-slice`

Status: `planned-not-launched`

## Objective

Rework the private Claude Code source adapter material from candidate
`1a080b1abf8e75dd9ecba607af4dca7c7141b3fb` onto latest main
`b82d052e8af9d0460cf73f82e587d84b969500b9` without promoting Claude Code as a
public source.

The slice is complete only when the adapter remains private, Codex behavior is
preserved, the W1B P1 risks are fixed, and focused verification proves the
source/selector and metadata/privacy boundaries.

## Required Reads

- `AGENTS.md`
- `docs/ROADMAP.md`
- `docs/workflows/2026-06-06-claude-code-source/README.md`
- `docs/workflows/2026-06-06-claude-code-source/workflow-state.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/W1A-truth-reconciliation.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/W1B-private-adapter-review.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/controller-wave1-synthesis.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/R1-remediation.md`
- Candidate evidence from `git show 1a080b1`
- Current-main drift in `src/sources/codex-parser.ts`, `src/format.ts`, and
  `src/query/snippet.ts`

## Required Fixes

- Enforce that any explicit selector used with the Claude Code adapter has
  source `claude-code` before inventory, snapshot, sync, coverage, count, or
  prune logic can run.
- Prevent skipped Claude records such as `isMeta`, `isSidechain`, diagnostics,
  tool-only, thinking, attachment, and parent/linked records from influencing
  searchable text, session identity, `cwd`, timestamps, inventory grouping,
  source fingerprints, coverage freshness, or read projections.
- Keep public CLI behavior Codex-only. `--source claude-code` and selector JSON
  requesting `claude-code` must still be rejected unless a later promotion slice
  explicitly changes this.
- Preserve current-main Codex behavior and current-main parser/snippet/format
  fixes. Do not reintroduce candidate drift from `1a080b1`.

## Test Requirements

- Negative test for explicit selector-source mismatch against the Claude Code
  adapter.
- Negative tests proving skipped/meta/sidechain-first records cannot set
  `sessionId`, `cwd`, or timestamp sentinel values used by indexed sessions,
  inventory, or coverage.
- Public CLI rejection tests for `--source claude-code` and selector JSON
  requesting `claude-code`.
- Regression coverage for existing Codex default behavior.
- Re-evaluate any test timeout increases from `1a080b1`; keep them only with
  clear evidence.

## Allowed Writes

- Product code and tests needed for the private adapter rework.
- A compact handoff at
  `docs/workflows/2026-06-06-claude-code-source/handoffs/C1-private-adapter-rework.md`.

## Forbidden

- Real Claude transcript content in committed fixtures or durable artifacts.
- Public docs, public skill, CLI help, package release notes, or README claims
  that Claude Code is supported.
- Version bump, release workflow edits, npm publish, global install, skill
  install, push, PR, or merge.
- Reverting unrelated user/controller changes.
- Using W1B replacement evidence unless the controller explicitly says the
  original W1B handoff failed.

## Expected Proof

- `npm run check`
- Focused unit tests covering the required fixes.
- CLI smoke proving public rejection of `claude-code`.
- Private synthetic-fixture smoke proving a valid private Claude adapter path
  can sync/read without real transcript content.
- `git diff --check`
- `git status --short`

## Expected Handoff

Write a compact handoff at the allowed handoff path. Use
`templates/C1-handoff-template.md` as the structure and include:

- task_id, thread_id, cwd, branch, commit
- summary of code/test changes
- how each W1B P1 finding was fixed
- public-boundary proof
- commands run and decisive results
- residual risks, blockers, or follow-up slices
- files touched
- noise_events, efficiency_notes, tool_fit

The controller will reconcile the handoff against
`C1-acceptance-checklist.md` and `verification-runbook.md`; include enough
evidence for every checklist item.
