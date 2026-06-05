# Workflow State

## Snapshot

- Updated: 2026-06-05
- Status: Wave 0 in progress
- Orchestrator Goal: `启动 cxs 多源架构改造的 Codex Session Orchestrator 工作流 Wave 0`
- Mainline intent: `int_c1da6c9e`
- Branch: `codex/session-sources-workflow`
- Canonical control plane: `docs/workflows/2026-06-05-session-sources/`

## Active Wave

Wave 0: create durable control-plane files and starter prompts.

Next after Wave 0:

1. Commit and seal the control-plane slice if verification passes.
2. Launch A1, A2, and A3 as read-only worker sessions.
3. Update `session-registry.md` with actual thread ids.

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

