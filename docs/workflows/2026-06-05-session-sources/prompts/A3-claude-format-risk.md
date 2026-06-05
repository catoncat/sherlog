You are executing `2026-06-05-session-sources/A3`.

Use the `codex-session-orchestrator` skill.

Goal:
Assess Claude Code transcript format risk and define the reserved boundary without publishing a Claude adapter.

First action:
Call `create_goal` with:
`2026-06-05-session-sources: A3 - Assess Claude Code transcript risk boundary`

Read:

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/milestone-plan.md`
- `docs/workflows/2026-06-05-session-sources/tasks/A3-claude-format-risk.md`

Work:

- Prefer official Claude Code documentation for claims.
- You may inspect local `~/.claude/projects` only for structural field names/counts and only if needed.
- Do not copy transcript content, secrets, tool output, or private user text into the handoff.
- Do not add code or docs outside the handoff.
- Do not commit, seal, push, open PRs, release, or update installed tools.

Return:

- conclusion
- official-source citations
- reserved architecture boundary
- deferred adapter questions
- safe parser filter recommendations
- files/docs read
- blockers or decisions needed
- noise_events
- efficiency_notes
- tool_fit

