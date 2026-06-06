# W1A Truth Reconciliation

Mode: `audit-track`

## Objective

Reconcile latest main, the completed source foundation workflow, Mainline intent
`int_b6b9939a`, and proposed private adapter commit `1a080b1`. Decide what the
controller should treat as true before launching implementation.

## Required Reads

- `AGENTS.md`
- `docs/ROADMAP.md`
- `docs/workflows/2026-06-06-claude-code-source/README.md`
- `docs/workflows/2026-06-06-claude-code-source/workflow-state.md`
- `docs/workflows/2026-06-05-session-sources/workflow-state.md`
- `docs/workflows/2026-06-05-session-sources/session-registry.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/R1-remediation.md`
- Mainline: `mainline status --json`, `mainline context --current --json`, `mainline show int_b6b9939a --json`
- Git evidence around `b82d052` and `1a080b1`

## Allowed Writes

- `docs/workflows/2026-06-06-claude-code-source/handoffs/W1A-truth-reconciliation.md`

## Forbidden

- Product code, tests, package files, release config, global tools, installed skills, real transcript fixtures.
- Commit, Mainline append/seal, push, PR, release, install.

## Expected Output

Write a compact handoff with:

- task_id, thread_id, cwd, branch, commit=`none`
- status
- main vs candidate relationship
- changed-file overlap and likely conflict points
- Mainline state summary
- recommendation: rebase/cherry-pick/split/rework/abandon
- proof commands and short decisive results
- blockers or semantic conflicts
- noise_events, efficiency_notes, tool_fit
