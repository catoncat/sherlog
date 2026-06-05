# A3: Claude Code Format Risk Packet

Mode: `decision-packet`

## Objective

Assess the minimum safe boundary for future Claude Code support without publishing a Claude Code adapter in this workflow.

## Read Paths

- Official Claude Code documentation for local session storage and transcript behavior.
- Optional local sample inspection under `~/.claude/projects` only if available and only for non-secret structural evidence.
- Existing cxs docs and parser boundaries:
  - `docs/ARCHITECTURE.md`
  - `src/parser.ts`
  - `src/source-inventory.ts`
  - `src/types.ts`

## Allowed Writes

- None by default. Return handoff in final.
- If explicitly asked by orchestrator, write only `docs/workflows/2026-06-05-session-sources/handoffs/A3-claude-format-risk.md`.

## Forbidden

- Do not index Claude data.
- Do not add Claude adapter code.
- Do not copy secrets, `.env` content, tool outputs, or private transcript content into the handoff.
- Do not treat local samples as a stable public schema.
- No Mainline append, seal, commit, push, PR, release, or global install.

## Decision Questions

Answer these directly:

- What is stable enough to reserve in the architecture now?
- What must remain deferred until adapter implementation?
- How should `cwd`, timestamp, title, user/assistant text, tool_use/tool_result, attachments, `isMeta`, `isSidechain`, and `parentUuid` be handled at the boundary level?
- What should docs say so agents do not believe Claude support is published?

## Expected Output

Produce a risk packet with official-source citations, optional local-structure notes, parser filter recommendations, and deferred questions.

## Proof

- Link official docs used.
- If local samples are inspected, report only structural field names and counts, never content.
- Include `git status --short` result.

## Escalation

Stop if safe assessment requires reading sensitive transcript content.
