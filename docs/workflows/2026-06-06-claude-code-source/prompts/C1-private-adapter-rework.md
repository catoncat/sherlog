# C1 Private Adapter Rework Starter Prompt

```text
<codex_delegation>
  <source_thread_id>019e9b54-7344-7a51-86a8-db3d2e3db02b</source_thread_id>
  <input>You are executing `2026-06-06-claude-code-source/C1-private-adapter-rework`.

Use `codex-session-orchestrator`, `mainline`, `superpowers:using-git-worktrees`, `superpowers:test-driven-development`, and `superpowers:verification-before-completion`.

Goal:
`2026-06-06-claude-code-source: C1 - Rework private Claude Code adapter onto latest main without public promotion`

First action: call `create_goal` with that objective.

Important boundary:
- This is an implementation worker, not the controller.
- Keep Claude Code private/non-public.
- Do not commit, seal, push, PR, release, install, or update global skills unless the controller explicitly lifts that boundary.
- Do not ingest, copy, quote, or commit real Claude transcript content.
- Do not use the W1B replacement thread as evidence; use the original W1B canonical handoff only.

Report first:
- `pwd`, repo root, branch/detached, HEAD, `git status --short`
- whether this worktree starts from latest main `b82d052e8af9d0460cf73f82e587d84b969500b9`

Read:
- `AGENTS.md`
- `docs/ROADMAP.md`
- `docs/workflows/2026-06-06-claude-code-source/README.md`
- `docs/workflows/2026-06-06-claude-code-source/workflow-state.md`
- `docs/workflows/2026-06-06-claude-code-source/tasks/C1-private-adapter-rework.md`
- `docs/workflows/2026-06-06-claude-code-source/C1-acceptance-checklist.md`
- `docs/workflows/2026-06-06-claude-code-source/templates/C1-handoff-template.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/W1A-truth-reconciliation.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/W1B-private-adapter-review.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/controller-wave1-synthesis.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/R1-remediation.md`
- candidate diff from `git show 1a080b1`

Implement only the private adapter rework required by the C1 task file:
1. Reapply/reimplement useful private Claude Code adapter material from `1a080b1` onto latest main.
2. Fix selector-source mismatch before inventory/snapshot/sync/coverage/prune can run.
3. Ensure skipped Claude records cannot set searchable text, session identity, cwd, timestamps, inventory grouping, fingerprints, coverage freshness, or read projections.
4. Preserve current-main Codex parser truncation and snippet/format behavior.
5. Keep the public CLI rejecting `claude-code`.
6. Use synthetic fixtures only.

Required proof:
- focused tests for the W1B P1 fixes and public CLI rejection
- `npm run check`
- CLI rejection smoke for `claude-code`
- private synthetic-fixture sync/read smoke
- `git diff --check`
- `git status --short`

Allowed handoff write:
- `docs/workflows/2026-06-06-claude-code-source/handoffs/C1-private-adapter-rework.md`

Expected final/handoff:
Use `../templates/C1-handoff-template.md`. Summarize code/test changes, how each W1B P1 risk was fixed, public-boundary proof, commands and decisive results, files touched, residual risks/blockers, noise_events, efficiency_notes, and tool_fit. Include enough evidence for the controller to fill every row in `C1-acceptance-checklist.md`.</input>
</codex_delegation>
```
