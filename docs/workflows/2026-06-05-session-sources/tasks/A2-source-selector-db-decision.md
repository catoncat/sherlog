# A2: Source, Selector, And DB Identity Decision

Mode: `decision-packet`

## Objective

Recommend the compatibility model for source identity across selectors, coverage records, sessions, messages, FTS rows, and read commands.

## Read Paths

- `src/types.ts`
- `src/selector.ts`
- `src/db/schema.ts`
- `src/db/session-store.ts`
- `src/db/coverage-store.ts`
- `src/db/sql.ts`
- `src/query/read.ts`
- `src/query/search.ts`
- `src/query/list.ts`
- `src/query/find.ts`
- `src/indexer.ts`
- `src/status.ts`
- related tests in `src/**/*.test.ts`

## Allowed Writes

- None by default. Return handoff in final.
- If explicitly asked by orchestrator, write only `docs/workflows/2026-06-05-session-sources/handoffs/A2-source-selector-db-decision.md`.

## Forbidden

- No source edits.
- No migration implementation.
- No Mainline append, seal, commit, push, PR, release, or global install.

## Decision Questions

Answer these directly:

- Should selector JSON include `source`? If yes, required or defaulted?
- Should `coverage` store `source_id` separately from selector JSON?
- Should `sessions.session_uuid` remain the external read key or become an internal source-qualified key?
- Should `native_session_id` be stored?
- How should old Codex rows be backfilled?
- What index version bump is needed?
- What breaks if future Claude Code native UUID equals a Codex UUID?
- How should `read-range <sessionUuid>` stay compatible?

## Expected Output

Produce one recommended model plus rejected alternatives. Include DB migration outline, compatibility behavior, and test targets.

## Proof

- Cite current schema and query constraints by file and line.
- Include risks that must be represented in D1.

## Escalation

Stop if a safe model requires changing the fixed command set.

