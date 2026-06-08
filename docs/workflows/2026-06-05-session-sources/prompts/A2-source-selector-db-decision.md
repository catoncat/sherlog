You are executing `2026-06-05-session-sources/A2`.

Use the `codex-session-orchestrator` skill.

Goal:
Decide the source, selector, coverage, and DB identity model for the `Sherlog` multi-source foundation.

First action:
Call `create_goal` with:
`2026-06-05-session-sources: A2 - Decide source selector DB identity model`

Read:

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/milestone-plan.md`
- `docs/workflows/2026-06-05-session-sources/tasks/A2-source-selector-db-decision.md`

Work:

- Stay read-only unless the orchestrator explicitly asks you to write the handoff file.
- Answer every decision question in the task file.
- Cite current schema/query constraints by file and line.
- Do not implement anything.
- Do not commit, seal, push, open PRs, release, or update installed tools.

Return:

- conclusion and recommended model
- rejected alternatives
- migration outline
- compatibility behavior
- test targets
- files read
- blockers or decisions needed
- noise_events
- efficiency_notes
- tool_fit
