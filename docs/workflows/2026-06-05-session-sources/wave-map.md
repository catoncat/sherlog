# Wave Map

This file is the context-compaction recovery point for the multi-source workflow.

## Objective

Build the multi-source foundation for `cxs` without publishing Claude Code support and without changing the fixed command surface.

## Canonical Control Plane

- Directory: `docs/workflows/2026-06-05-session-sources/`
- Current design: `design.md`
- Current registry: `session-registry.md`
- Current state: `workflow-state.md`
- Worker outputs: `handoffs/`

## Locked Decisions

- `codex` is the default and only public source in this workflow.
- `claude-code` is reserved/non-public. Do not advertise or implement public Claude sync.
- Missing public source input defaults to `codex`.
- Canonical selectors include `source`.
- Selector implication and coverage are false across sources.
- DB/session identity must include `source_id`, `native_session_id`, and an internal source-qualified key.
- Bare Codex UUID reads remain compatible.
- `sync` remains the only index-writing command.
- Command names stay fixed.

## Wave Status

- Wave 0 control plane: complete.
- Wave 1 A1/A2/A3 packets: complete and reconciled.
- Wave 2 D1 design packet: complete and reconciled.
- Wave 3 implementation: I1, I2, and I3 complete; I4 active.
- Wave 4 evidence/review: pending implementation.

## Next Execution Order

1. I1: complete. Extracted source adapter interface, registry, and Codex adapter while preserving current Codex behavior.
2. I2: complete. Added source-aware selector, coverage, DB migration/backfill, and query/read identity safety.
3. I3: complete. Wired `--source codex` through all fixed commands and rejected unsupported/non-public sources.
4. I4: active. Update docs and `skill-packages/cxs` only after behavior exists.
5. E1: run evidence gates and record source checkout, release skill, npm CLI, and installed CLI state separately.
6. R1: review source boundary, compatibility, and accidental Claude-public wording.

## Stop Lines

- Do not add a public Claude Code adapter.
- Do not add commands.
- Do not add watcher, daemon, or realtime sync.
- Do not update global `cxs`, npm release, global skill, push, or PR unless explicitly authorized.
- Do not let one source's sync, prune, coverage, or query mutate or read another source accidentally.
