You are executing `2026-06-05-session-sources/E1`.

Use the `codex-session-orchestrator` skill.

Goal:
Collect verification evidence for the multi-source foundation.

First action:
Call `create_goal` with:
`2026-06-05-session-sources: E1 - Verify multi-source foundation`

Read:

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/milestone-plan.md`
- `docs/workflows/2026-06-05-session-sources/tasks/E1-verification.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- I1/I2/I3/I4 handoffs.

Work:

- Evidence only.
- Do not fix code or docs.
- Run the task file checks or record exactly why a check cannot run.
- Write or return an evidence matrix.
- Do not commit, seal, push, open PRs, release, or update installed tools.

Return:

- conclusion
- requirement-to-proof matrix
- command results
- missing or weak evidence
- blockers or decisions needed
- noise_events
- efficiency_notes
- tool_fit
