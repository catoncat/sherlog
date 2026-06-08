# D1 Handoff: Architecture Design Packet

Thread: `019e9700-f56c-7523-93b4-1da1c2a76b72`
Status: completed
Mode: `decision-packet`

## Conclusion

Wrote the multi-source foundation design packet. The design makes `source_id` an explicit selector, coverage, DB, query, and read dimension; keeps Codex as the default and only public source; preserves bare Codex UUID compatibility; and reserves Claude Code as non-public future adapter territory.

## Files Read

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/milestone-plan.md`
- `docs/workflows/2026-06-05-session-sources/tasks/D1-architecture-design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/A1-codex-assumption-inventory.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/A2-source-selector-db-decision.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/A3-claude-format-risk.md`
- `src/types.ts`
- `src/selector.ts`
- `src/db/schema.ts`
- `src/db/session-store.ts`
- `src/db/coverage-store.ts`
- `src/db/sql.ts`
- `src/query/read.ts`
- `src/query/find.ts`
- `src/query/search.ts`
- `src/source-inventory.ts`
- `src/env.ts`
- `src/parser.ts`
- `src/status.ts`
- `src/indexer.ts`
- `src/cli.ts`
- `src/query/list.ts`
- `src/query/stats.ts`

## Files Changed

- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/D1-architecture-design.md`

## Proof Commands And Results

- Initial identity readback:
  - `pwd` -> `/Users/envvar/.codex/worktrees/fe42/cxs`
  - `git rev-parse --show-toplevel` -> `/Users/envvar/.codex/worktrees/fe42/cxs`
  - `git branch --show-current || true` -> empty, detached HEAD
  - `git rev-parse HEAD` -> `e5567b6172cb27fd6458629328ef5e4ff77b6aa7`
  - `git status --short` -> clean
- `mainline status --json` -> ok; repo initialized, detached `HEAD`, no active intent, sync fresh; unrelated uncovered/stale-proposal guidance not acted on.
- `mainline context --current --json` -> confirmed this workflow's current decisions: A1/A2/A3 reconciled and D1 is the next design task.
- `git diff --check` -> exit 0.
- `git status --short` after writing -> only the two allowed new files are untracked.

## Decisions Represented

- A1 represented: design names Codex-only assumptions in root resolution, inventory, parser, selector, DB, coverage, CLI, query/read, docs, and skill wording.
- A2 represented: design requires `source_id`, `native_session_id`, and `session_key`; source-aware selector/coverage/DB/query/read; Codex default canonicalization; old Codex backfill; and bare UUID compatibility.
- A3 represented: design reserves `claude-code`, keeps Claude non-public, makes future decoding adapter-owned, recommends SDK-reader first for public behavior, and defers raw JSONL/tool/attachment/sidechain semantics.

## Unresolved Decisions

- Exact public JSON output field names for new source metadata should be finalized in I2/I3 tests before docs/skill publication.
- SQLite migration mechanics may require table rebuilds for uniqueness changes.
- Future ambiguous bare-id read error shape is deferred until a second public source exists.
- Future Claude public support should make a fresh SDK-vs-raw decision with current docs and samples.
- Cross-source aggregate `stats` are deferred; phase one should stay selected-source scoped.

## Implementation Wave Recommendation

Proceed to Wave 3 only after the orchestrator accepts `design.md`. Recommended order:

1. I1 creates source id, registry, and Codex adapter with behavior-preserving tests.
2. I2 applies source-aware selector, coverage, DB migration, query/read/delete/replace, and FTS identity changes.
3. I3 wires `--source codex` and unsupported-source errors through every fixed command.
4. I4 updates checkout docs and release skill wording after behavior exists.

## Noise Events

- No missing A1/A2/A3 handoff.
- No failed required command before writing.
- Mainline reported unrelated uncovered commits and stale proposals; left untouched because D1 is docs-only within a bounded workflow directory.
- Memory quick-pass found only broad Sherlog startup-overhead context, not a material D1 design input.

## Efficiency Notes

- Used parallel reads for workflow files and code evidence.
- Kept writes to the two allowed files.
- Did not run implementation tests because D1 is a decision packet; required proof is `git diff --check`.

## Tool Fit

- `codex-session-orchestrator` fit the delegated Goal and handoff shape.
- Mainline context fit boundary awareness and confirmed D1 sequencing.
- Shell reads and `apply_patch` were sufficient; no browser, npm, release, PR, or installed-tool actions were used.
