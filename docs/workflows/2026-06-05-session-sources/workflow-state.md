# Workflow State

## Snapshot

- Updated: 2026-06-05
- Status: Wave 1 packets reconciled; Wave 2 ready
- Orchestrator Goal: `启动 cxs 多源架构改造的 Codex Session Orchestrator 工作流 Wave 0`
- Mainline intent: `int_c1da6c9e`
- Branch: `codex/session-sources-workflow`
- Canonical control plane: `docs/workflows/2026-06-05-session-sources/`

## Active Wave

Wave 2 ready: A1, A2, and A3 completed and their handoffs have been reconciled.

Next:

1. Launch D1 architecture design packet.
2. Reconcile D1 into `design.md` and `handoffs/D1-architecture-design.md`.
3. Decide whether to launch implementation slices I1/I2/I3.

## Decisions

Locked:

- The first public implementation keeps Codex as the default source.
- Claude Code adapter is reserved/experimental and not published in the first phase.
- Command names stay fixed.
- Worker sessions must have their own Goals.

Pending:

- Whether selector JSON gains required or optional `source`.
- Whether DB introduces `source_id`, `native_session_id`, and internal `session_key`.
- How to keep `read-range <sessionUuid>` compatible if future native IDs collide.
- Whether `--source` defaults to `codex` for all commands or only selector-building commands.

## Heartbeat

- heartbeat_status: none
- wakeups_used: 0
- wakeups_max: 0
- stop_when: no heartbeat is planned for Wave 0

## State Log

- 2026-06-05: Created isolated worktree from `origin/main` because local `main` had proposed Mainline overlap.
- 2026-06-05: Started Mainline intent `int_c1da6c9e`.
- 2026-06-05: Created and sealed Wave 0 control-plane commit `9b34079`.
- 2026-06-05: Requested A1/A2/A3 worker sessions; launcher returned pending worktree ids.
- 2026-06-05: Resolved A1/A2/A3 actual thread ids and reconciled their read-only handoffs.
