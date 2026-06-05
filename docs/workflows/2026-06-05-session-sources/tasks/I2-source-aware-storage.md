# I2: Source-Aware Storage And Coverage

Mode: `implementation-slice`

## Objective

Implement source-aware selector, coverage, and DB identity changes chosen by D1 without breaking existing Codex rows or read workflows.

## Read Paths

- D1 design packet.
- `src/types.ts`
- `src/selector.ts`
- `src/db/schema.ts`
- `src/db/session-store.ts`
- `src/db/coverage-store.ts`
- `src/db/sql.ts`
- `src/query/**`
- related DB, selector, query, and migration tests.

## Allowed Writes

Expected bounded paths, subject to D1:

- `src/types.ts`
- `src/selector.ts`
- `src/db/**`
- `src/query/**` only where source identity is required
- related tests
- `docs/workflows/2026-06-05-session-sources/handoffs/I2-source-aware-storage.md`

## Forbidden

- Do not change command names.
- Do not implement Claude Code parsing.
- Do not delete indexed rows as a migration shortcut.
- Do not change prune semantics unless D1 explicitly requires it.
- No docs/skill edits outside handoff.
- No push, PR, release, global skill install, or local CLI install.

## Proof

- Migration/backfill test for old Codex data shape.
- Selector implication tests for same-source and cross-source behavior.
- Coverage freshness tests.
- `npm run check`.
- `git diff --check`.

## Commit And Seal

Use an isolated worktree. Start or confirm a Mainline intent for I2. Commit and seal only the verified I2 slice.

## Escalation

Stop if D1 leaves `session_uuid` identity unresolved.

