You are executing `2026-06-05-session-sources/I3`.

Use the `codex-session-orchestrator` skill.

Goal:
Add CLI `--source codex` behavior while preserving fixed command names and default Codex behavior.

First action:
Call `create_goal` with:
`2026-06-05-session-sources: I3 - Add CLI source option behavior`

Read:

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/milestone-plan.md`
- `docs/workflows/2026-06-05-session-sources/tasks/I3-cli-source-option.md`
- `docs/workflows/2026-06-05-session-sources/design.md`

Work:

- Use an isolated worktree.
- Start or confirm a Mainline intent for I3.
- Keep writes inside the task file scope.
- Do not add new commands.
- Do not claim Claude Code support exists.
- Commit and seal only a verified I3 slice.
- Do not push, open PRs, release, or update installed tools.

Return:

- conclusion
- files changed
- proof commands and results
- CLI compatibility notes
- commit and Mainline seal status
- blockers or decisions needed
- noise_events
- efficiency_notes
- tool_fit

