# Session Registry

| Task | Thread | Goal | Status | Scope | Proof | Last Update | Next |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | `019e96fa-e597-7ca3-9749-4e738a1c6781` | `2026-06-05-session-sources: A1 - Inventory Codex single-source assumptions` | verified | read-only code inventory | handoff written | 2026-06-05 | closed |
| A2 | `019e96fb-126c-7b02-8417-b955db7f6af1` | `2026-06-05-session-sources: A2 - Decide source selector DB identity model` | verified | read-only architecture decision | handoff written | 2026-06-05 | closed |
| A3 | `019e96fb-47ef-7531-a6ef-918b1b9f3209` | `2026-06-05-session-sources: A3 - Assess Claude Code transcript risk boundary` | verified | read-only docs/sample evidence | handoff written | 2026-06-05 | closed |
| D1 | `019e9700-f56c-7523-93b4-1da1c2a76b72` | `2026-06-05-session-sources: D1 - Write architecture design packet` | verified | design doc only | design and handoff written | 2026-06-05 | closed |
| I1 | `019e9711-5a26-7530-bc95-40a38cd49061` | `2026-06-05-session-sources: I1 - Extract Codex source adapter` | active-replacement | bounded source files | replacement thread running in `/Users/envvar/.codex/worktrees/b3c6/cxs`; original `019e970f-ab59-73c2-b5ec-f7d08d6d04bc` hit repeated `systemError` | 2026-06-05 | wait for handoff |
| I2 | TBD | `2026-06-05-session-sources: I2 - Add source-aware storage and coverage` | ready-after-I1 | bounded DB/selector files | design ready | 2026-06-05 | wait for I1 contract |
| I3 | TBD | `2026-06-05-session-sources: I3 - Add CLI source option behavior` | ready-after-I2 | bounded CLI/status/indexer files | design ready | 2026-06-05 | wait for source-aware storage |
| I4 | TBD | `2026-06-05-session-sources: I4 - Align docs and release skill` | planned | docs/skill only | pending | 2026-06-05 | wait for I3 |
| E1 | TBD | `2026-06-05-session-sources: E1 - Verify multi-source foundation` | planned | evidence only | pending | 2026-06-05 | wait for implementation |
| R1 | TBD | `2026-06-05-session-sources: R1 - Review final multi-source slice` | planned | findings only | pending | 2026-06-05 | wait for E1 |

## Registry Rules

- `TBD` or pending worktree ids must be replaced when actual thread ids are available.
- A task is not `verified` until proof is recorded in `handoffs/<task-id>.md` or reconciled from the thread final.
- Main thread must reconcile worker handoffs before launching dependent tasks.
