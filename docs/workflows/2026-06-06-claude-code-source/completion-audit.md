# Completion Audit

status: `incomplete`

This audit tracks the full objective:

> Evolve `cxs` from Codex-only local session search into a reliable
> source-aware local session retrieval engine. Preserve existing Codex behavior.
> Promote Claude Code support only after adapter strategy, privacy filtering,
> tests, docs, skill source, release, and installed smoke all pass.

The goal is not complete. Current evidence proves the source-aware foundation,
Wave 1 control-plane reconciliation, C1 private Claude Code adapter rework, R2
independent post-rework review, V1 current-checkout verification, D1 public
docs/contract alignment, and S1 distributable skill-source alignment.
L1 lifecycle has a scoped local commit and Mainline seal/lint proof. P1
release-prep has bumped the package version to `0.3.5`, passed local release
checks, pushed the branch, opened draft PR #51, and PR CI is green. No PR merge,
tag, GitHub Actions publish, npm registry update, installed CLI update, or
global skill update has completed. Installed smoke is still pending.

## Evidence Classes

- `proved`: authoritative evidence exists in current files or command output.
- `partial`: useful evidence exists, but not enough for completion.
- `pending`: no completion evidence yet.
- `blocked`: cannot proceed until an earlier milestone passes or current pause
  is lifted.

## Requirements Matrix

| Requirement | Status | Current Evidence | Missing Evidence / Next Gate |
| --- | --- | --- | --- |
| Preserve fixed command surface: `status`, `sync`, `find`, `read-range`, `read-page`, `list`, `stats` | proved | `README.md` and project `AGENTS.md` record this boundary; C1 public CLI smokes keep `claude-code` rejected; V1 `npm run cxs -- --help` lists only the fixed command surface plus `help` | None for checkout behavior; release/install still have separate rows |
| Preserve existing Codex behavior by default | proved | Foundation is already on main; C1 focused Codex tests and `npm run check` passed; R2 found no current-main parser/snippet/format drift; V1 Codex synthetic sync/find/read smoke passed | None for checkout behavior; release/install still have separate rows |
| Treat source identity as first-class retrieval architecture | proved | Prior source-aware foundation is on main; C1 commit `55c0638` registers private `claude-code` with source-qualified identity; R2 reviewed the integrated identity behavior; V1 private Claude smoke proved source-qualified private indexing/read isolation | None for checkout behavior; release/install still have separate rows |
| Do not promote `1a080b1` as-is | proved | `handoffs/controller-wave1-synthesis.md` says do not promote/merge/release/install candidate as-is | None for this decision |
| Rework private Claude Code adapter from latest main | proved | C1 commit `55c0638` and `handoffs/C1-private-adapter-rework.md`; checklist all pass | None for C1; still needs R2/V1 before promotion |
| Fix selector/source mismatch risk | proved | C1 focused test and `src/indexer.ts` / `src/sources/claude-code-inventory.ts` guards reject source mismatch before sync/snapshot/coverage/prune; R2 confirmed no missed P1 path | None for this decision |
| Fix skipped-record metadata/privacy risk | proved | C1 parser/inventory/sync-read tests prove meta/sidechain/tool-only sentinels cannot set identity, cwd, timestamps, grouping, fingerprints, coverage input, or projections; R2 confirmed W1B P1 fixed | None for this decision |
| Keep Claude Code private until promotion gate | proved | C1 registers `claude-code` as `public: false`; CLI smokes reject public `claude-code`; R2 confirmed no public docs/skill/package overclaim; V1 public `--source` and selector rejection smokes returned `unsupported_source` | None until a later explicit public promotion gate |
| Use only synthetic fixtures; no real Claude transcript content | proved | C1 tests and smoke use synthetic temp JSONL; controller diff review and R2 review found no real transcript fixture/content in touched files | None for current private gate |
| Independent post-rework review | proved | R2 handoff `handoffs/R2-post-rework-review.md` found no unresolved P1 and recommends V1 | None for R2 |
| Verification gate covers actual requirements | proved | V1 handoff `handoffs/V1-verification.md` covers `npm run check`, CLI help/status/rejection, Codex synthetic smoke, private Claude synthetic smoke, timeout grep, and final status | None for V1 |
| Update public docs only after behavior is proven | proved | D1 handoff `handoffs/D1-docs-contract-update.md` records docs-only updates after V1, CLI help/readbacks, unsupported-source smoke, and `git diff --check` | None for D1; skill source remains separate |
| Update `skill-packages/cxs` source to match verified CLI behavior | proved | S1 handoff `handoffs/S1-skill-source-update.md` records skill source diff, `npx skills ls -g --json`, CLI help/readback, unsupported-source smoke, and `git diff --check`; wording keeps public source Codex-only and `claude-code` private/non-public | None for source-layer skill text; global installed skill remains separate |
| Commit and Mainline seal scoped verified work | proved | Local L1 commit `169d343` integrates C1 implementation, D1 docs, S1 skill source, and controller handoffs after `npm run check`, CLI help/readback, unsupported-source smokes, `npx skills ls -g --json`, and diff checks passed; `mainline seal --submit` published `int_c0ac32dc`; `mainline lint int_c0ac32dc --json` passed | None for L1 |
| Push/release through real registry workflow | partial | `package.json` and `package-lock.json` are bumped to `0.3.5`; registry readback before release is `0.3.4`; `npm run check`, `npm run build`, and `npm pack --dry-run` passed for `@act0r/cxs@0.3.5`; `int_c9461f18` seal/lint passed; branch pushed; PR #51 is `OPEN`, `isDraft=true`, `mergeStateStatus=CLEAN`, has no reviews, and CI run `27061046513` workflow `ci` job `test` succeeded | PR #51 still needs review/merge; then push `v0.3.5` tag or trigger release workflow, verify GitHub Actions and `npm view @act0r/cxs version` |
| Verify local installed CLI from PATH | blocked | `command -v cxs` currently resolves `/Users/envvar/Library/pnpm/bin/cxs`; `which -a cxs` also shows `/Users/envvar/Library/pnpm/cxs`; `cxs --version` is still `0.3.4` | Blocked on registry release |
| Update global skill from published source path if needed | blocked | I1 milestone forbids dirty checkout/symlink updates | Blocked on release and skill source verification |

## Current Authoritative State

- Current controller branch: `codex/claude-code-source-controller`.
- Current workflow status: draft PR #51 open with CI green; release/install pending.
- C1 worker thread: `019e9c11-bf21-7921-8128-9123ef439c61`.
- C1 worktree: `/Users/envvar/.codex/worktrees/35c5/cxs`.
- C1 commit: `55c0638`.
- R2 review thread: `019e9c46-2e32-7683-bb63-5c1b30d35c35`.
- R2 worktree: `/Users/envvar/.codex/worktrees/3004/cxs`.
- R2 handoff: `handoffs/R2-post-rework-review.md`.
- V1 verification handoff: `handoffs/V1-verification.md`.
- D1 docs handoff: `handoffs/D1-docs-contract-update.md`.
- S1 skill handoff: `handoffs/S1-skill-source-update.md`.
- Product implementation, docs, skill source, workflow artifacts, and version
  bump are integrated on branch `codex/claude-code-source-controller`.
- Draft PR #51 is open: `https://github.com/catoncat/cxs/pull/51`.
- PR #51 is still a draft/open PR; CI run `27061046513` `test` succeeded and
  merge state is `CLEAN`.
- No PR merge, tag, GitHub Actions release/publish, npm registry update,
  installed CLI update, or global skill update has occurred.

## Completion Rule

Do not mark the Goal complete until every row in the requirements matrix is
`proved` with current evidence. Passing `npm run check` alone is insufficient:
release, registry, local PATH install, and global skill state each need their
own proof when they are in scope.

## Next Evidence To Collect

Review/merge PR #51 if accepted, then trigger the real release path with
`v0.3.5` and verify GitHub Actions plus `npm view @act0r/cxs version`.
Release publication and installed state remain gated.
