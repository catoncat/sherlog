# Milestone Plan

status: `completed`

This plan is the controller gate map for moving from source-aware foundation to
public-ready Claude Code support. It records the required sequence and the
completion evidence now collected for this workflow.

## Boundary

- This workflow has already crossed the commit, seal, push, merge, release,
  install, and global skill update gates recorded below.
- `claude-code` still remains private/non-public in the released CLI; public
  CLI support continues to expose only `codex`.
- Real Claude transcript content must not be committed or copied into durable
  workflow artifacts.
- Future adapter expansion or public promotion requires a new workflow, not an
  implicit continuation of this closeout record.

## Layers

Keep these layers separate in every handoff and closeout:

- Source checkout: repository code and `skill-packages/sherlog` source.
- Skill source: release artifact under `skill-packages/sherlog`.
- npm registry CLI: `@act0r/sherlog` published package.
- Local PATH CLI: the actual binary resolved by `command -v shlog` /
  `which -a shlog`.

## Milestones

### W1: Truth Reconciliation

Status: `reconciled`

Evidence:

- `handoffs/W1A-truth-reconciliation.md`
- `handoffs/W1B-private-adapter-review.md`
- `handoffs/controller-wave1-synthesis.md`

Exit decision:

- `1a080b1` is a private spike only.
- Replay onto latest main is Git-feasible, but candidate must be reworked before
  merge or public promotion.

### C1: Private Adapter Rework

Status: `reconciled`

Task:

- `tasks/C1-private-adapter-rework.md`
- `prompts/C1-private-adapter-rework.md`

Required exit evidence:

- Implementation handoff `handoffs/C1-private-adapter-rework.md`.
- C1 local commit `55c0638`.
- W1B P1 fixes proven by focused tests.
- Public CLI still rejects `claude-code`.
- Private synthetic-fixture sync/read smoke succeeds without real transcript
  content.
- `npm run check`, `git diff --check`, and final status proof.

Gate:

- If C1 does not prove privacy and selector/source integrity, do not advance to
  public docs, skill, release, or install work.

### R2: Post-Rework Review

Status: `reconciled`

Mode: `review-session`

Task:

- `tasks/R2-post-rework-review.md`
- `prompts/R2-post-rework-review.md`

Required exit evidence:

- Independent review handoff for C1 diff:
  `handoffs/R2-post-rework-review.md`.
- Findings classified as fixed, accepted residual risk, or blocker.
- No public-surface overclaim.
- No committed real transcript content.
- R2 thread `019e9c46-2e32-7683-bb63-5c1b30d35c35` found no unresolved P1 and
  recommended V1.

Gate:

- P1/P2 findings must be resolved or explicitly carried as non-public blockers
  before verification broadens.

### V1: Verification Gate

Status: `reconciled`

Mode: `evidence-session`

Required exit evidence:

- `npm run check`.
- Focused CLI smoke for current checkout.
- Synthetic private Claude fixture smoke.
- Codex regression smoke proving default behavior is preserved.
- Review of test timeouts and coverage relevance.
- `git status --short`.
- Handoff `handoffs/V1-verification.md` proves this gate passed against C1
  commit `55c0638`.

Task:

- `tasks/V1-verification.md`
- `prompts/V1-verification.md`

Gate:

- Verification must prove the actual requirements, not merely pass unrelated
  tests.

### D1: Public Docs And Contract Update

Status: `reconciled`

Mode: `implementation-slice`

Scope:

- Update current-state docs only after source behavior is proven.
- Keep docs precise about private vs public support.
- Do not describe Claude Code as public unless the promotion gate has already
  passed.

Required exit evidence:

- Docs diff reviewed against current code.
- No stale target-state claims.
- `git diff --check`.
- Handoff `handoffs/D1-docs-contract-update.md` proves this gate passed against
  C1 commit `55c0638` with docs-only changes.

Task:

- `tasks/D1-docs-contract-update.md`
- `prompts/D1-docs-contract-update.md`

### S1: Skill Source Update

Status: `reconciled`

Mode: `implementation-slice`

Scope:

- Update `skill-packages/sherlog` to match verified CLI behavior.
- Keep dogfood/dev-only workflow out of public skill.
- Keep release-layer wording explicit: skill install does not install the CLI.

Required exit evidence:

- Skill source diff.
- `npx skills` source/packaging checks where applicable.
- CLI help/readback used by the skill still matches current source behavior.
- Handoff `handoffs/S1-skill-source-update.md` proves this gate passed against
  C1 commit `55c0638` plus D1 docs changes.

### L1: Lifecycle Commit And Mainline Seal

Status: `sealed`

Mode: `commit-seal-prep`

Required exit evidence:

- Clean or scoped worktree.
- Focused verification rerun after final source/skill/doc changes.
- Scoped L1 commit integrating C1 implementation, D1 docs, S1 skill source,
  and controller handoffs.
- Mainline seal prepared/submitted with no conflicts returned.
- `mainline lint int_c0ac32dc --json` passed.

Gate:

- Do not seal unverified public claims or unresolved C1/R2 blockers.

### P1: Push, Release, And Registry Verification

Status: `completed`

Mode: `release-session`

Required exit evidence:

- Package version bumped from `0.3.4` to `0.3.5`.
- Release-prep verification: `npm run check`, `npm run build`, and
  `npm pack --dry-run`.
- Branch pushed: `origin/codex/claude-code-source-controller`.
- PR #51 merged into `main` with squash commit
  `bcc43dd9f1e6caf0774dbb45867294db56ad38ad`.
- Latest PR branch CI readback before merge: workflow `ci`, run `27062651358`,
  job `test`, conclusion `SUCCESS`; Cubic re-review run also `SUCCESS`.
- Release tag `v0.3.5` pushed and GitHub Actions release workflow run
  `27063398021` completed successfully.
- `npm view @act0r/sherlog version` returned `0.3.5`.

Gate:

- Do not call source checkout behavior "released" until registry readback proves
  it.
- Do not tag, merge, or publish from this branch until review/PR state is
  explicit and green.

### I1: Local Install And Installed Smoke

Status: `completed`

Mode: `evidence-session`

Required exit evidence:

- `command -v shlog` and `which -a shlog`.
- `shlog --version` equals published registry version.
- Installed `shlog status --json` smoke proves SQLite/native addon loads.
- Installed CLI smoke covers Codex default behavior.
- If Claude Code is public by then, installed smoke must also cover its public
  command path with synthetic fixtures.
- Global skill update, if needed, must use the published GitHub source path, not
  local dirty rsync or symlink.

Gate:

- Do not report local install complete until PATH and installed binary behavior
  are proven.

Installed exit evidence:

- `command -v shlog` -> `/Users/envvar/Library/pnpm/bin/cxs`
- `which -a shlog` -> `/Users/envvar/Library/pnpm/bin/cxs`,
  `/Users/envvar/Library/pnpm/cxs`
- `shlog --version` -> `0.3.5`
- `shlog status --json` passed
- `shlog list --cwd /Users/envvar/.codex/worktrees/4b9e/cxs --limit 3 --json`
  passed
- `npx skills add catoncat/sherlog --full-depth --skill sherlog -g -a codex -y`
  updated the global skill and `npx skills ls -g --json` shows path
  `/Users/envvar/.agents/skills/cxs`

## Next Launch

This workflow is complete. Future work should start a new workflow only if
there is a new public-promotion, post-release bugfix, or further adapter-scope
change to pursue.
