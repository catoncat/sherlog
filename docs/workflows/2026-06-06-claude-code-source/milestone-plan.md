# Milestone Plan

status: `planned`

This plan is the controller gate map for moving from source-aware foundation to
public-ready Claude Code support. It records required sequence and evidence; it
does not mark any future milestone launched or complete.

## Boundary

- Current user boundary pauses orchestration expansion: no new workers, commit,
  seal, push, release, install, or global skill update.
- Until that boundary is lifted, only controller-owned workflow artifacts may
  change.
- `claude-code` remains private/non-public until the public-promotion gate
  explicitly passes.
- Real Claude transcript content must not be committed or copied into durable
  workflow artifacts.

## Layers

Keep these layers separate in every handoff and closeout:

- Source checkout: repository code and `skill-packages/cxs` source.
- Skill source: release artifact under `skill-packages/cxs`.
- npm registry CLI: `@act0r/cxs` published package.
- Local PATH CLI: the actual binary resolved by `command -v cxs` /
  `which -a cxs`.

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

- Update `skill-packages/cxs` to match verified CLI behavior.
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

Status: `release-prep-committed`

Mode: `release-session`

Required exit evidence:

- Package version bumped from `0.3.4` to `0.3.5`.
- Release-prep verification: `npm run check`, `npm run build`, and
  `npm pack --dry-run`.
- Push main or release branch according to repo process.
- Tag or release workflow evidence.
- GitHub Actions readback.
- `npm view @act0r/cxs version` proves registry publication.

Gate:

- Do not call source checkout behavior "released" until registry readback proves
  it.
- Do not tag, merge, or publish from this branch until review/PR state is
  explicit and green.

### I1: Local Install And Installed Smoke

Status: `blocked-on-P1`

Mode: `evidence-session`

Required exit evidence:

- `command -v cxs` and `which -a cxs`.
- `cxs --version` equals published registry version.
- Installed `cxs status --json` smoke proves SQLite/native addon loads.
- Installed CLI smoke covers Codex default behavior.
- If Claude Code is public by then, installed smoke must also cover its public
  command path with synthetic fixtures.
- Global skill update, if needed, must use the published GitHub source path, not
  local dirty rsync or symlink.

Gate:

- Do not report local install complete until PATH and installed binary behavior
  are proven.

## Next Launch

Seal release-prep next, then push the branch and open a draft PR. Do not merge,
tag, publish to npm, update PATH `cxs`, or update the global skill until the
review and release gates provide evidence.
