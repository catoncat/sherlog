# A1 Handoff: Codex Single-Source Assumption Inventory

Thread: `019e96fa-e597-7ca3-9749-4e738a1c6781`
Status: completed
Mode: `inventory-packet`

## Conclusion

Current `cxs` has no non-Codex source implementation. Single-source assumptions concentrate in default root resolution, Codex JSONL parser/event model, source inventory cwd/date inference, selector/coverage identity, DB uniqueness, CLI defaults, and release skill wording.

## Key Inventory

| Area | Evidence | Finding | Owner |
| --- | --- | --- | --- |
| Default root | `src/env.ts:35`, `src/env.ts:53` | Default sessions root and resolver are Codex-named. | I1/D1 |
| CLI framing/defaults | `src/cli.ts:39`, `src/cli.ts:70`, `src/cli.ts:355`, `src/cli.ts:359` | CLI text and selector default use Codex sessions root. | I3/I4 |
| Parser | `src/parser.ts:23`, `src/parser.ts:104`, `src/parser.ts:122`, `src/parser.ts:127` | Parser only handles Codex `session_meta`, `turn_context`, `compacted`, `response_item.reasoning`, and `event_msg`. | I1 |
| Message roles | `src/types.ts:1`, `src/types.ts:10`, `src/parser.ts:138` | Canonical roles are user/assistant; `sourceKind` is Codex `event_msg`. | D1/I1 |
| Session id | `src/parser.ts:28`, `src/parser.ts:147` | Fallback session UUID is extracted from filename. | D1/I2 |
| Inventory | `src/source-inventory.ts:57`, `src/source-inventory.ts:91`, `src/source-inventory.ts:110`, `src/source-inventory.ts:139` | Inventory scans `.jsonl`, reads cwd from Codex metadata in first 64 KiB. | I1/I2 |
| Path dates | `src/source-inventory.ts:64`, `src/source-inventory.ts:67` | Dates inferred from Codex path/file naming. | I1/D1 |
| Selector | `src/types.ts:37`, `src/selector.ts:55`, `src/selector.ts:75` | Selector/implication model has root/cwd/date only, no source. | D1/I2 |
| DB identity | `src/db/schema.ts:17`, `src/db/schema.ts:18`, `src/db/schema.ts:57`, `src/db/session-store.ts:81` | Global unique `session_uuid`, `file_path`, and `(session_uuid, seq)` are source-blind. | D1/I2 |
| Coverage | `src/db/schema.ts:81`, `src/db/coverage-store.ts:16` | Coverage key is selector JSON only, source-blind. | I2 |
| Query SQL | `src/db/sql.ts:4`, `src/db/sql.ts:8` | Selector SQL filters by file path under root plus cwd/date. | I2 |
| Status/sync coupling | `src/status.ts:8`, `src/status.ts:67`, `src/indexer.ts:13`, `src/indexer.ts:159` | Status and sync are wired to Codex inventory/parser. | I1/I3 |
| Public docs/skill | `docs/ARCHITECTURE.md:5`, `skill-packages/cxs/SKILL.md:3`, `skill-packages/cxs/references/json-schema.md:169` | Public docs and release skill frame behavior as Codex history; JSON schema exposes `sourceRoot` but no source id. | I4/D1 |

## Proof

- Worker cwd: `/Users/envvar/.codex/worktrees/85ff/cxs`
- Worker git status: clean detached HEAD at `9b34079`
- No files changed by worker.

## Decisions Needed

A2/D1 must decide whether source lives in selector JSON, DB namespace, CLI context, or all three. Highest risk is DB identity: global `session_uuid`, `file_path`, message uniqueness, coverage key, and prune scope all need source-aware behavior before a second source can be real.

## Noise / Efficiency / Tool Fit

- `noise_events`: no failed commands reported; worker did not observe the initial projectId launch correction.
- `efficiency_notes`: worker used scoped reads and `rg`; no tests needed for read-only inventory.
- `tool_fit`: `codex-session-orchestrator` fit the inventory-packet flow.
