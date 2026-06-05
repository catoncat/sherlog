You are executing `2026-06-05-session-sources/I4`.

Use the `codex-session-orchestrator` skill.

Goal:
Align docs and release skill text with the implemented source foundation without overclaiming Claude Code support.

First action:
Call `create_goal` with:
`2026-06-05-session-sources: I4 - Align docs and release skill`

Read:

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/milestone-plan.md`
- `docs/workflows/2026-06-05-session-sources/tasks/I4-docs-skill-alignment.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- I1/I2/I3 handoffs.

Work:

- Use an isolated worktree.
- Start or confirm a Mainline intent for I4.
- Keep writes inside the task file scope.
- Do not edit private dogfood data.
- Do not update installed global skills or local installed CLI.
- Commit and seal only a verified docs/skill slice.
- Do not push, open PRs, release, or update installed tools.

Return:

- conclusion
- files changed
- proof commands and results
- release/install boundary notes
- commit and Mainline seal status
- blockers or decisions needed
- noise_events
- efficiency_notes
- tool_fit
