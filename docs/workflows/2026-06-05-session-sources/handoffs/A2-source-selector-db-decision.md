# A2 Handoff: Source, Selector, And DB Identity Decision

Thread: `019e96fb-126c-7b02-8417-b955db7f6af1`
Status: completed
Mode: `decision-packet`

## Conclusion

Recommended model: `source_id` becomes an explicit DB, selector, coverage, and query dimension. `codex` is the default public source. Input selector JSON may omit `source`, but canonical internal selectors should contain `source: "codex"`. Do not keep treating naked `session_uuid` as the global DB identity.

## Current Constraints

- `Selector` has no source: `src/types.ts:37`, `src/selector.ts:27`, `src/selector.ts:55`
- `sessions.session_uuid` is globally unique: `src/db/schema.ts:17`
- `messages` unique key is `(session_uuid, seq)`: `src/db/schema.ts:57`
- `coverage.selector_key` is globally unique: `src/db/schema.ts:81`
- FTS tables store only `session_uuid`: `src/db/schema.ts:68`, `src/db/schema.ts:127`
- `replaceSession` finds existing row by `session_uuid OR file_path`: `src/db/session-store.ts:82`
- Delete/read/range/query paths use bare session UUID: `src/db/session-store.ts:64`, `src/query/read.ts:20`, `src/db/message-store.ts:20`, `src/query/find.ts:68`
- Selector SQL filters only file path/cwd/date: `src/db/sql.ts:4`
- Current index version is `cxs-v6-selector-provenance`: `src/env.ts:36`

## Decisions

- Selector JSON should include `source`; canonicalization defaults missing source to `codex`.
- Coverage should store `source_id` separately and make uniqueness source-aware.
- Keep existing Codex `session_uuid` as compatibility input/output, but add `source_id`, `native_session_id`, and a source-qualified internal key such as `session_key`.
- Backfill old Codex rows with `source_id='codex'`, `native_session_id=session_uuid`, and `session_key='codex:' || session_uuid`.
- Bump index version, e.g. `cxs-v7-source-identity`.
- Bare `read-range <uuid>` should resolve to Codex for backward compatibility; future ambiguous reads need source-qualified form such as `codex:<id>` / `claude:<id>` without adding commands.

## Rejected Alternatives

- Only add `source` to selector JSON: insufficient because read, messages, FTS, deletes, and session replacement still collide.
- Rewrite `session_uuid` everywhere to `source:<uuid>` immediately: too broad and likely breaks existing reads/JSON.
- Separate DB per source: fragments future unified find/list/stats.
- Rely on file path uniqueness only: query/read identity is session-oriented.

## Migration Outline

1. Add `source_id`, `native_session_id`, and optional `session_key` to `sessions`.
2. Rework uniqueness around source-aware identity.
3. Prefer `session_id, seq` for message identity; avoid bare `session_uuid` as the only relation key.
4. Recreate or migrate FTS metadata to carry source-qualified identity, or always join by rowid/session id.
5. Add `coverage.source_id`; rebuild coverage selector keys.
6. Default old selectors and rows to Codex.
7. Bump `INDEX_VERSION`; stale coverage is rebuilt by normal sync.

## Test Targets

- Missing selector source canonicalizes to Codex.
- Cross-source selector implication fails.
- Coverage is source-aware.
- Old DB rows backfill as Codex.
- Same native ID can exist in two sources.
- Bare `read-range <uuid>` still resolves Codex.
- Prune/delete/replace cannot affect another source.
- FTS search does not dedupe colliding native IDs.

## Noise / Efficiency / Tool Fit

- `noise_events`: worker attempted one nonexistent `src/db/query-store.ts`; corrected to real stores.
- `efficiency_notes`: read-only decision packet; no tests or writes.
- `tool_fit`: shell and `nl -ba` were sufficient for line-cited evidence.
