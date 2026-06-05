You are executing `2026-06-05-session-sources/I1`.

Use the `codex-session-orchestrator` skill.

Goal:
Extract Codex source discovery and parsing behind a source adapter while preserving behavior.

First action:
Call `create_goal` with:
`2026-06-05-session-sources: I1 - Extract Codex source adapter`

Read:

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/milestone-plan.md`
- `docs/workflows/2026-06-05-session-sources/wave-map.md`
- `docs/workflows/2026-06-05-session-sources/tasks/I1-codex-adapter.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/D1-architecture-design.md`

Work:

- Use an isolated worktree.
- Start or confirm a Mainline intent for I1.
- Keep writes inside the task file scope.
- Do not add Claude Code adapter implementation.
- Commit and seal only a verified I1 slice.
- Do not push, open PRs, release, or update installed tools.

Return:

- conclusion
- files changed
- proof commands and results
- commit and Mainline seal status
- blockers or decisions needed
- noise_events
- efficiency_notes
- tool_fit
