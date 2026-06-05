# Session Registry

| Task | Thread | Goal | Status | Scope | Proof | Last Update | Next |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | `019e96fa-e597-7ca3-9749-4e738a1c6781` | `2026-06-05-session-sources: A1 - Inventory Codex single-source assumptions` | verified | read-only code inventory | handoff written | 2026-06-05 | closed |
| A2 | `019e96fb-126c-7b02-8417-b955db7f6af1` | `2026-06-05-session-sources: A2 - Decide source selector DB identity model` | verified | read-only architecture decision | handoff written | 2026-06-05 | closed |
| A3 | `019e96fb-47ef-7531-a6ef-918b1b9f3209` | `2026-06-05-session-sources: A3 - Assess Claude Code transcript risk boundary` | verified | read-only docs/sample evidence | handoff written | 2026-06-05 | closed |
| D1 | TBD | `2026-06-05-session-sources: D1 - Write architecture design packet` | planned | design doc only | A1-A3 ready | 2026-06-05 | launch |
| I1 | TBD | `2026-06-05-session-sources: I1 - Extract Codex source adapter` | planned | bounded source files | pending | 2026-06-05 | wait for D1 |
| I2 | TBD | `2026-06-05-session-sources: I2 - Add source-aware storage and coverage` | planned | bounded DB/selector files | pending | 2026-06-05 | wait for D1 |
| I3 | TBD | `2026-06-05-session-sources: I3 - Add CLI source option behavior` | planned | bounded CLI/status/indexer files | pending | 2026-06-05 | wait for D1 |
| I4 | TBD | `2026-06-05-session-sources: I4 - Align docs and release skill` | planned | docs/skill only | pending | 2026-06-05 | wait for I3 |
| E1 | TBD | `2026-06-05-session-sources: E1 - Verify multi-source foundation` | planned | evidence only | pending | 2026-06-05 | wait for implementation |
| R1 | TBD | `2026-06-05-session-sources: R1 - Review final multi-source slice` | planned | findings only | pending | 2026-06-05 | wait for E1 |

## Registry Rules

- `TBD` or pending worktree ids must be replaced when actual thread ids are available.
- A task is not `verified` until proof is recorded in `handoffs/<task-id>.md` or reconciled from the thread final.
- Main thread must reconcile worker handoffs before launching dependent tasks.
