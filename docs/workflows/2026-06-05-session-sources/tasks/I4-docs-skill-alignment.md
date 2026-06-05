# I4: Docs And Release Skill Alignment

Mode: `implementation-slice`

## Objective

Align current-state docs and the release `cxs` skill package with the implemented multi-source foundation without claiming Claude Code support is published.

## Read Paths

- D1 design packet.
- I1/I2/I3 handoffs.
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `README.md`
- `skill-packages/cxs/SKILL.md`
- `skill-packages/cxs/references/**`

## Allowed Writes

Expected bounded paths, subject to D1 and implementation results:

- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `README.md` only if public CLI help changes.
- `skill-packages/cxs/**`
- related docs tests if present
- `docs/workflows/2026-06-05-session-sources/handoffs/I4-docs-skill-alignment.md`

## Forbidden

- Do not edit private dogfood goldens.
- Do not install or rsync global skills.
- Do not publish npm or update local PATH CLI.
- Do not state that Claude Code adapter is available.
- No push, PR, release, global skill install, or local CLI install.

## Proof

- `git diff --check`.
- `npx skills ls -g --json` only if D1 says global skill state must be inspected; do not update it.
- `cxs --help` only for installed release behavior, clearly labeled as release behavior.
- Checkout CLI help via `npm run cxs -- --help` if CLI help changed.

## Commit And Seal

Use an isolated worktree. Start or confirm a Mainline intent for I4. Commit and seal only the verified docs/skill slice.

## Escalation

Stop if docs need to claim unpublished behavior to make the workflow sound complete.

