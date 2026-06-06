# Completion Audit

status: `incomplete`

This audit tracks the full objective:

> Evolve `cxs` from Codex-only local session search into a reliable
> source-aware local session retrieval engine. Preserve existing Codex behavior.
> Promote Claude Code support only after adapter strategy, privacy filtering,
> tests, docs, skill source, release, and installed smoke all pass.

The goal is not complete. Current evidence proves only the source-aware
foundation and Wave 1 control-plane reconciliation. Product implementation,
verification, public docs/skill, release, and installed smoke are still pending.

## Evidence Classes

- `proved`: authoritative evidence exists in current files or command output.
- `partial`: useful evidence exists, but not enough for completion.
- `pending`: no completion evidence yet.
- `blocked`: cannot proceed until an earlier milestone passes or current pause
  is lifted.

## Requirements Matrix

| Requirement | Status | Current Evidence | Missing Evidence / Next Gate |
| --- | --- | --- | --- |
| Preserve fixed command surface: `status`, `sync`, `find`, `read-range`, `read-page`, `list`, `stats` | partial | `README.md` and project `AGENTS.md` record this boundary | C1/V1 must prove public CLI behavior remains unchanged |
| Preserve existing Codex behavior by default | partial | Foundation is already on main; C1 task requires Codex regression proof | C1 implementation proof and V1 Codex regression smoke |
| Treat source identity as first-class retrieval architecture | partial | Prior source-aware foundation is on main; W1A/W1B inputs and `milestone-plan.md` preserve this direction | C1 must rework Claude adapter onto current source architecture |
| Do not promote `1a080b1` as-is | proved | `handoffs/controller-wave1-synthesis.md` says do not promote/merge/release/install candidate as-is | None for this decision |
| Rework private Claude Code adapter from latest main | pending | `tasks/C1-private-adapter-rework.md` and `prompts/C1-private-adapter-rework.md` prepared | Launch C1 after pause lifts; require implementation handoff |
| Fix selector/source mismatch risk | pending | W1B P1 finding captured; C1 task requires fix | C1 tests and handoff proving mismatch rejection before sync/coverage/prune |
| Fix skipped-record metadata/privacy risk | pending | W1B P1 findings captured; C1 task requires fix | C1 tests proving skipped/meta/sidechain records cannot set identity, cwd, timestamps, inventory, fingerprints, coverage, or projections |
| Keep Claude Code private until promotion gate | partial | `operating-rules.md`, `milestone-plan.md`, and C1 prompt all require private/non-public behavior | C1/R2/V1 must verify no public CLI/docs/skill overclaim |
| Use only synthetic fixtures; no real Claude transcript content | partial | Operating rules and C1 task forbid real transcript content | C1/R2 must inspect changed fixtures and proof |
| Independent post-rework review | blocked | R2 milestone exists | Blocked on C1 handoff |
| Verification gate covers actual requirements | blocked | V1 milestone names required proof | Blocked on C1 and R2 |
| Update public docs only after behavior is proven | blocked | D1 milestone is blocked on V1 | Blocked on V1 |
| Update `skill-packages/cxs` source to match verified CLI behavior | blocked | S1 milestone is blocked on D1 | Blocked on docs and source verification |
| Commit and Mainline seal scoped verified work | blocked | L1 milestone records required lifecycle proof | Blocked on source/skill verification and current user pause |
| Push/release through real registry workflow | blocked | P1 milestone records registry evidence requirement | Blocked on lifecycle gate and current user pause |
| Verify local installed CLI from PATH | blocked | I1 milestone records `command -v`, `which -a`, `cxs --version`, and `cxs status --json` requirements | Blocked on registry release |
| Update global skill from published source path if needed | blocked | I1 milestone forbids dirty checkout/symlink updates | Blocked on release and skill source verification |

## Current Authoritative State

- Current controller branch: `codex/claude-code-source-controller`.
- Current workflow status: Wave 1 reconciled; paused before next worker.
- Next launch after pause lifts: C1 only.
- C1 is not launched.
- No worker after W1 has been launched.
- No product code has been changed by this controller after the pause.
- No commit, Mainline append/seal, push, release, install, or global skill
  update has occurred after the pause.

## Completion Rule

Do not mark the Goal complete until every row in the requirements matrix is
`proved` with current evidence. Passing `npm run check` alone is insufficient:
release, registry, local PATH install, and global skill state each need their
own proof when they are in scope.

## Next Evidence To Collect

When the user lifts the pause, launch C1 and require its handoff to update this
audit. The controller should then reclassify the affected rows before deciding
whether R2 can launch.
