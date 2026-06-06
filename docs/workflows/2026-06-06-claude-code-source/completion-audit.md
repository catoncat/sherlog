# Completion Audit

status: `incomplete`

This audit tracks the full objective:

> Evolve `cxs` from Codex-only local session search into a reliable
> source-aware local session retrieval engine. Preserve existing Codex behavior.
> Promote Claude Code support only after adapter strategy, privacy filtering,
> tests, docs, skill source, release, and installed smoke all pass.

The goal is not complete. Current evidence proves the source-aware foundation,
Wave 1 control-plane reconciliation, and C1 private Claude Code adapter rework.
Independent review, verification, public docs/skill, lifecycle, release, and
installed smoke are still pending.

## Evidence Classes

- `proved`: authoritative evidence exists in current files or command output.
- `partial`: useful evidence exists, but not enough for completion.
- `pending`: no completion evidence yet.
- `blocked`: cannot proceed until an earlier milestone passes or current pause
  is lifted.

## Requirements Matrix

| Requirement | Status | Current Evidence | Missing Evidence / Next Gate |
| --- | --- | --- | --- |
| Preserve fixed command surface: `status`, `sync`, `find`, `read-range`, `read-page`, `list`, `stats` | partial | `README.md` and project `AGENTS.md` record this boundary; C1 public CLI smokes keep `claude-code` rejected | V1 must prove public CLI behavior remains unchanged after integration |
| Preserve existing Codex behavior by default | partial | Foundation is already on main; C1 focused Codex tests and `npm run check` passed | R2/V1 Codex regression review and smoke |
| Treat source identity as first-class retrieval architecture | partial | Prior source-aware foundation is on main; C1 commit `55c0638` registers private `claude-code` with source-qualified identity | R2/V1 review of integrated behavior |
| Do not promote `1a080b1` as-is | proved | `handoffs/controller-wave1-synthesis.md` says do not promote/merge/release/install candidate as-is | None for this decision |
| Rework private Claude Code adapter from latest main | proved | C1 commit `55c0638` and `handoffs/C1-private-adapter-rework.md`; checklist all pass | None for C1; still needs R2/V1 before promotion |
| Fix selector/source mismatch risk | proved | C1 focused test and `src/indexer.ts` / `src/sources/claude-code-inventory.ts` guards reject source mismatch before sync/snapshot/coverage/prune | R2 review should confirm no missed path |
| Fix skipped-record metadata/privacy risk | proved | C1 parser/inventory/sync-read tests prove meta/sidechain/tool-only sentinels cannot set identity, cwd, timestamps, grouping, fingerprints, coverage input, or projections | R2 review should confirm no missed skipped-record class |
| Keep Claude Code private until promotion gate | partial | C1 registers `claude-code` as `public: false`; CLI smokes reject public `claude-code`; docs/skill/package were not promoted | R2/V1 and later docs/skill review must verify no overclaim |
| Use only synthetic fixtures; no real Claude transcript content | partial | C1 tests and smoke use synthetic temp JSONL; controller diff review found no real transcript fixture/content in touched files | R2 independent review must confirm |
| Independent post-rework review | pending | R2 milestone exists; C1 is reconciled and ready for review | Launch R2 |
| Verification gate covers actual requirements | blocked | V1 milestone names required proof | Blocked on R2 |
| Update public docs only after behavior is proven | blocked | D1 milestone is blocked on V1 | Blocked on V1 |
| Update `skill-packages/cxs` source to match verified CLI behavior | blocked | S1 milestone is blocked on D1 | Blocked on docs and source verification |
| Commit and Mainline seal scoped verified work | blocked | L1 milestone records required lifecycle proof | Blocked on source/skill verification and current user pause |
| Push/release through real registry workflow | blocked | P1 milestone records registry evidence requirement | Blocked on lifecycle gate and current user pause |
| Verify local installed CLI from PATH | blocked | I1 milestone records `command -v`, `which -a`, `cxs --version`, and `cxs status --json` requirements | Blocked on registry release |
| Update global skill from published source path if needed | blocked | I1 milestone forbids dirty checkout/symlink updates | Blocked on release and skill source verification |

## Current Authoritative State

- Current controller branch: `codex/claude-code-source-controller`.
- Current workflow status: C1 reconciled; R2 review next.
- C1 worker thread: `019e9c11-bf21-7921-8128-9123ef439c61`.
- C1 worktree: `/Users/envvar/.codex/worktrees/35c5/cxs`.
- C1 commit: `55c0638`.
- Product implementation exists only on the C1 worker branch; controller copied
  the handoff into the control plane but did not edit product code.
- No push, PR, release, install, or global skill update has occurred.

## Completion Rule

Do not mark the Goal complete until every row in the requirements matrix is
`proved` with current evidence. Passing `npm run check` alone is insufficient:
release, registry, local PATH install, and global skill state each need their
own proof when they are in scope.

## Next Evidence To Collect

Launch R2 post-rework review against C1 commit `55c0638`. If R2 finds no P1
blocker, run V1 verification before touching public docs, skill source,
lifecycle, release, or installed state.
