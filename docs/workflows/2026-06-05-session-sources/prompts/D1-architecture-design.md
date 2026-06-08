You are executing `2026-06-05-session-sources/D1`.

Use the `codex-session-orchestrator` skill.

Goal:
Write the architecture design packet for the `Sherlog` multi-source foundation.

First action:
Call `create_goal` with:
`2026-06-05-session-sources: D1 - Write architecture design packet`

Read:

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/milestone-plan.md`
- `docs/workflows/2026-06-05-session-sources/tasks/D1-architecture-design.md`
- A1/A2/A3 handoffs after the orchestrator has written them.

Work:

- Do not start until A1, A2, and A3 handoffs exist.
- Write only `docs/workflows/2026-06-05-session-sources/design.md` and your D1 handoff.
- Do not implement source changes.
- Run `git diff --check`.
- Do not push, open PRs, release, or update installed tools.

Return:

- conclusion
- files changed
- proof commands and results
- unresolved decisions
- implementation wave recommendation
- noise_events
- efficiency_notes
- tool_fit
