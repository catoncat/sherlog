You are executing `2026-06-05-session-sources/I2`.

Use the `codex-session-orchestrator` skill.

Goal:
Implement source-aware storage, selector, and coverage behavior selected by D1.

First action:
Call `create_goal` with:
`2026-06-05-session-sources: I2 - Add source-aware storage and coverage`

Read:

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/milestone-plan.md`
- `docs/workflows/2026-06-05-session-sources/wave-map.md`
- `docs/workflows/2026-06-05-session-sources/tasks/I2-source-aware-storage.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/D1-architecture-design.md`
- I1 handoff after the orchestrator has written it.

Work:

- Use an isolated worktree.
- Start or confirm a Mainline intent for I2.
- Keep writes inside the task file scope.
- Do not implement Claude Code parsing.
- Do not delete existing Codex data as a shortcut.
- Commit and seal only a verified I2 slice.
- Do not push, open PRs, release, or update installed tools.

Return:

- conclusion
- files changed
- proof commands and results
- migration compatibility evidence
- commit and Mainline seal status
- blockers or decisions needed
- noise_events
- efficiency_notes
- tool_fit
