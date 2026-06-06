# R2 Post-Rework Review

Mode: `review-session`

Status: `planned`

## Objective

Independently review C1 commit `55c0638bcab28ee431b7ca70f145615e07d25f69`
for private Claude Code adapter correctness, privacy boundaries, and readiness
to proceed to V1 verification.

R2 is findings-only. It must not implement fixes, publish, release, install, or
promote Claude Code as a public source.

## Required Reads

- `AGENTS.md`
- `docs/ROADMAP.md`
- `docs/workflows/2026-06-06-claude-code-source/README.md`
- `docs/workflows/2026-06-06-claude-code-source/workflow-state.md`
- `docs/workflows/2026-06-06-claude-code-source/operating-rules.md`
- `docs/workflows/2026-06-06-claude-code-source/verification-runbook.md`
- `docs/workflows/2026-06-06-claude-code-source/C1-acceptance-checklist.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/C1-private-adapter-rework.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/W1B-private-adapter-review.md`
- C1 diff: `git show --stat --patch 55c0638bcab28ee431b7ca70f145615e07d25f69`

## Review Focus

- Selector/source mismatch: prove every C1 path rejects mismatched selector
  source before Claude inventory, snapshot, sync, coverage, count, or prune can
  mutate state.
- Skipped-record privacy: prove skipped/meta/sidechain/tool/thinking/attachment
  records cannot affect session identity, cwd, timestamps, searchable text,
  inventory grouping, fingerprints, coverage freshness, or read projections.
- Public boundary: public CLI and docs/skill/package surfaces must not claim or
  accept public `claude-code`.
- Codex regression: C1 must not regress default Codex source behavior, current
  parser truncation, format, or snippet behavior.
- Fixture policy: no real Claude transcript content or durable private data.
- Test adequacy: focused tests and smokes must cover W1B P1 findings; broad
  `npm run check` is supporting evidence only.

## Allowed Writes

- `docs/workflows/2026-06-06-claude-code-source/handoffs/R2-post-rework-review.md`

## Forbidden

- Product code, tests, docs outside the allowed handoff, package files, release
  config, global tools, installed skills, real transcript fixtures.
- Commit, Mainline append/seal, push, PR, release, install, global skill update.
- Using W1B replacement evidence.

## Expected Proof

- `git status --short`
- `git diff --stat 55c0638^ 55c0638`
- `git show --stat --patch 55c0638`
- Targeted file reads for C1 source/test files.
- Optional focused test reruns only if needed to validate a suspected finding.

## Expected Handoff

Write findings first, ordered by severity. If no blocker is found, state that
explicitly. Include:

- task_id, thread_id, cwd, branch, reviewed_commit
- findings with file/line references where possible
- W1B P1 status: fixed, still open, or unknown
- public-boundary status
- real transcript exposure status
- test adequacy status
- residual risks and whether they block V1
- commands/readbacks used
- recommendation: proceed to V1 or block with required fix
- noise_events, efficiency_notes, tool_fit
