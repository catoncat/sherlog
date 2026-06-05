# I2 Handoff: Source-Aware Storage And Coverage

Thread: `019e971b-b2f9-7a12-880c-556612b7b1d8`
Status: completed
Mode: `implementation-slice`
Mainline intent: `int_737064b8`

## Conclusion

Implemented source-aware selector canonicalization, coverage, DB identity,
migration/backfill, query/read isolation, and FTS cleanup safety for the I2
slice. Codex remains the default and only public source. No CLI `--source`
option, Claude Code parser, release, global skill update, installed CLI update,
push, or PR was added.

## Actual Workspace

- cwd: `/Users/envvar/.codex/worktrees/3ff5/cxs`
- repo root: `/Users/envvar/.codex/worktrees/3ff5/cxs`
- initial branch: detached `HEAD`
- working branch created: `codex/session-sources-i2`
- starting commit: `22bba95f2f8e360749af0f4c592584a01b7e76e1`

## Files Read

- `docs/workflows/2026-06-05-session-sources/wave-map.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/D1-architecture-design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I1-codex-adapter.md`
- `docs/workflows/2026-06-05-session-sources/tasks/I2-source-aware-storage.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `src/types.ts`
- `src/selector.ts`
- `src/db/schema.ts`
- `src/db/session-store.ts`
- `src/db/message-store.ts`
- `src/db/coverage-store.ts`
- `src/db/list-store.ts`
- `src/db/stats-store.ts`
- `src/db/sql.ts`
- `src/query/read.ts`
- `src/query/find.ts`
- `src/query/search.ts`
- related selector, DB, query, CLI, and flow tests

## Files Changed

- `src/types.ts`
- `src/env.ts`
- `src/selector.ts`
- `src/sources/types.ts`
- `src/sources/codex-parser.ts`
- `src/db/schema.ts`
- `src/db/session-store.ts`
- `src/db/message-store.ts`
- `src/db/coverage-store.ts`
- `src/db/list-store.ts`
- `src/db/stats-store.ts`
- `src/db/sql.ts`
- `src/query/find.ts`
- `src/query/read.ts`
- `src/query/search.ts`
- `src/ranking.ts`
- `src/selector.test.ts`
- `src/db/sql.test.ts`
- `src/db/session-store.test.ts`
- `src/db/coverage-store.test.ts`
- `src/query-flow.test.ts`
- `src/cli.test.ts`
- `docs/workflows/2026-06-05-session-sources/handoffs/I2-source-aware-storage.md`

## Implementation Summary

- Added `SessionSourceId` and default `codex` source metadata to parsed session
  and selector types.
- Codex parser now returns `sourceId`, `nativeSessionId`, and `sessionKey`
  while preserving `sessionUuid`.
- Selector canonicalization now defaults missing `source` to `codex`; selector
  implication returns false across sources.
- `selectorWhereSql()` now includes `source_id = ?` in selector predicates.
- Bumped `INDEX_VERSION` to `cxs-v7-source-identity`.
- Rebuilt/migrated `sessions` to include `source_id`, `native_session_id`,
  `session_key`, `UNIQUE(source_id, native_session_id)`, and
  `UNIQUE(source_id, file_path)`.
- Rebuilt/migrated `messages` uniqueness from `(session_uuid, seq)` to
  `(session_id, seq)`.
- Added `coverage.source_id`; coverage selector JSON/storage keys now include
  canonical `source`.
- Preserved old Codex rows by backfilling `source_id = codex`,
  `native_session_id = session_uuid`, and `session_key = codex:<uuid>`.
- Query/search/list/stats default to Codex when no source selector is provided.
- Read paths resolve bare ids as Codex and source-qualified ids like
  `claude-code:<nativeId>` internally without changing CLI wiring.
- FTS cleanup now deletes by `rowid`/`session_id`, not bare `session_uuid`, so
  colliding native ids across sources do not delete each other's FTS rows.
- Prune/delete/replace paths are scoped by source.

## Proof Commands And Results

- Initial identity:
  - `pwd` -> `/Users/envvar/.codex/worktrees/3ff5/cxs`
  - repo root -> `/Users/envvar/.codex/worktrees/3ff5/cxs`
  - initial branch -> detached `HEAD`
  - initial commit -> `22bba95f2f8e360749af0f4c592584a01b7e76e1`
  - initial `git status --short` -> clean
- `mainline preflight --json`
  - returned `block` because current workflow proposed intents overlap the same
    D1/I1/I2 files.
  - inspected `int_b67df985`, `int_8cf31433`, and `int_3c3926e9`; overlap was
    expected workflow handoff/integration, not contradictory implementation.
- `mainline start "2026-06-05-session-sources: I2 - Add source-aware storage and coverage" --json`
  - created `int_737064b8` on `codex/session-sources-i2`.
- `npm ci`
  - exit 0; installed this worktree's dependencies from lockfile.
- `npm run check`
  - exit 0; `tsc --noEmit` passed; 27 test files passed; 148 tests passed.
- `git diff --check`
  - exit 0.
- Checkout CLI smoke with temporary Codex root:
  - `syncAdded=1`
  - `syncCoverageSource=codex`
  - `findResults=1`
  - `pageMessages=2`
  - `pageCoverageSource=codex`
  - `statsSessions=1`
  - `indexVersion=cxs-v7-source-identity`
- Old SQLite migration compatibility simulation:
  - old `sessions` + old `messages` schema migrated without deleting messages.
  - readback: `sourceId=codex`, message text preserved, `foreign_keys=1`.
- Boundary scan:
  - no `--source` option was added in `src/cli.ts`.
  - no Claude parser/public source wiring was added.

## Migration Compatibility Evidence

- Focused test covers old Codex `sessions` plus old `messages` rows and proves
  source identity backfill while preserving message rows.
- Manual old-FK simulation proved the session-table rebuild does not cascade
  delete old messages and leaves SQLite foreign keys enabled afterward.
- Index version bump ensures existing Codex rows with old index versions are not
  treated as fresh unchanged rows.

## I3 Contract

- I3 can wire CLI `--source codex` by passing source defaults into selector
  canonicalization and by keeping omitted source as Codex.
- Unsupported/non-public source handling still belongs to I3; I2 only reserves
  internal source-aware storage/query behavior.
- Public commands still work without `--source`; current JSON may expose
  canonical selector `source: "codex"` where selectors are returned.
- Bare `read-range <uuid>` and `read-page <uuid>` remain Codex-compatible.
- Source-qualified internal reads support `<source>:<nativeId>`; I3 should
  decide the public error contract for unsupported or ambiguous input.

## Blockers

None for I2.

## Noise Events

- `npm exec tsc -- --noEmit` was a wrong route before `node_modules` existed;
  npm attempted to install the unrelated `tsc` package. Resolved by `npm ci`
  and using repository scripts.
- `npm run check -- --runInBand` failed because this Vitest version does not
  support `--runInBand`; reran `npm run check`.
- Initial source-collision test exposed a real stale FTS cleanup bug: deleting
  by bare `session_uuid` removed another source's FTS rows. Fixed by deleting
  FTS rows by `rowid`/`session_id`.
- Old-FK migration simulation exposed that session table rebuild could cascade
  delete old messages. Fixed by disabling FK only during rebuild and restoring
  it after schema setup.

## Efficiency Notes

- Parallel reads were useful for workflow docs and source files.
- `npm ci` cost about 1 second; full `npm run check` cost about 4 seconds.
- The manual migration simulation saved risk versus relying only on the first
  backfill test.

## Tool Fit

- `codex-session-orchestrator` fit the delegated Goal/handoff workflow.
- Mainline fit task intent setup and overlap classification; preflight overlap
  was noisy but useful to confirm this branch starts from I1.
- Shell plus `apply_patch` fit the implementation and verification loop.
