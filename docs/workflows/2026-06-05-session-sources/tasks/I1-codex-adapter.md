# I1: Codex Source Adapter

Mode: `implementation-slice`

## Objective

Extract current Codex discovery and parsing behavior behind a source adapter and registry while preserving existing behavior.

## Read Paths

- D1 design packet.
- `src/env.ts`
- `src/parser.ts`
- `src/source-inventory.ts`
- `src/indexer.ts`
- `src/status.ts`
- related parser, inventory, indexer, and status tests.

## Allowed Writes

Expected bounded paths, subject to D1:

- `src/sources/**`
- `src/env.ts`
- `src/parser.ts`
- `src/source-inventory.ts`
- `src/indexer.ts`
- `src/status.ts`
- related focused tests
- `docs/workflows/2026-06-05-session-sources/handoffs/I1-codex-adapter.md`

## Forbidden

- Do not add Claude Code adapter implementation.
- Do not change DB schema unless D1 assigns it to I1.
- Do not change CLI public behavior.
- Do not edit docs/skill package outside handoff.
- No push, PR, release, global skill install, or local CLI install.

## Proof

- Focused tests for Codex parser/inventory/status/sync behavior.
- `npm run check` if touched code makes focused test selection uncertain.
- `git diff --check`.

## Commit And Seal

Use an isolated worktree. Start or confirm a Mainline intent for I1. Commit and seal only the verified I1 slice.

## Escalation

Stop if preserving behavior requires source-aware DB changes assigned to I2.

