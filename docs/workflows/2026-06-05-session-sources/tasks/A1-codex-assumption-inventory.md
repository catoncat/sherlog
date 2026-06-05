# A1: Codex Single-Source Assumption Inventory

Mode: `inventory-packet`

## Objective

Inventory every current Codex-only assumption that affects source discovery, parsing, selector filtering, coverage, DB identity, CLI defaults, docs, and release skill behavior.

## Read Paths

- `src/env.ts`
- `src/parser.ts`
- `src/source-inventory.ts`
- `src/indexer.ts`
- `src/status.ts`
- `src/selector.ts`
- `src/types.ts`
- `src/db/**`
- `src/query/**`
- `src/cli.ts`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `skill-packages/cxs/**`

## Allowed Writes

- None by default. Return handoff in final.
- If explicitly asked by orchestrator, write only `docs/workflows/2026-06-05-session-sources/handoffs/A1-codex-assumption-inventory.md`.

## Forbidden

- No source edits.
- No schema edits.
- No docs or skill edits outside the handoff.
- No Mainline append, seal, commit, push, PR, release, or global install.

## Expected Output

Produce a compact inventory with:

- file/function references
- assumption description
- why it is source-specific or source-neutral
- migration risk
- suggested owner task: I1, I2, I3, I4, or D1

## Proof

- Cite exact files and line numbers from current code.
- Include `git status --short` result.

## Escalation

Stop and report if current code contradicts the workflow scope, especially if a non-Codex source already exists.

