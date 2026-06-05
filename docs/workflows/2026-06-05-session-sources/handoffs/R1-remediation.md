# R1 Remediation Handoff

Status: completed in canonical branch
Mode: `review-fix-session`

## Findings Addressed

- P1 old-schema read-command UX: fixed.
- P1 release/install wording drift: fixed in README and skill package source.
- P2 coverage design drift: fixed in `docs/INDEX_COVERAGE_DESIGN.md`.

## Code Changes

- Added `IndexSchemaUpgradeRequiredError` and `withSourceAwareReadDb`.
- Kept `withReadDb` available for `status` so old-schema index status remains readable.
- Routed `find`, `list`, `read-range`, `read-page`, and `stats` through the source-aware read guard.
- Added CLI JSON/text error handling for `index_schema_upgrade_required`.
- Added CLI regression coverage for source-unaware indexes across all read-only commands.

## Documentation Changes

- README now distinguishes source checkout behavior from older installed npm/PATH CLI behavior.
- README documents that source-aware read commands do not migrate old indexes and require `sync`.
- `skill-packages/cxs` and references document old CLI `--source` fallback and the new error shape.
- `docs/INDEX_COVERAGE_DESIGN.md` now treats `source` as a selector and coverage dimension; implication is false across sources.

## Verification

- `npm run test -- src/cli.test.ts`: passed, 28 tests.
- `npm run check`: passed, 27 test files / 153 tests.
- `npm run cxs -- status --source codex --json`: passed against default local index, preserving old-schema status fallback.
- `npm run cxs -- list --source codex --json -n 1`: returned structured `index_schema_upgrade_required` against the old default local index.
- `npm run cxs -- stats --source codex --json`: returned structured `index_schema_upgrade_required` against the old default local index.
- `npm run cxs -- list --source codex --json --db docs/workflows/2026-06-05-session-sources/handoffs/E1-artifacts/e1-smoke.sqlite -n 1`: passed.
- `npm run cxs -- read-page e1e10000-e1e1-41e1-81e1-e1e1e1e1e1e1 --source codex --json --db docs/workflows/2026-06-05-session-sources/handoffs/E1-artifacts/e1-smoke.sqlite --limit 1`: passed.
- `npm run cxs -- find needle --source codex --json --db docs/workflows/2026-06-05-session-sources/handoffs/E1-artifacts/e1-smoke.sqlite`: passed.

## Boundaries

- No Claude Code adapter was implemented or advertised as public.
- No command names were added or removed.
- No watcher, daemon, or realtime sync was added.
- No npm release, global CLI update, global skill update, push, or PR was performed.
