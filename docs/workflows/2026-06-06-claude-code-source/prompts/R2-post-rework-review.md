# R2 Post-Rework Review Starter Prompt

```text
<codex_delegation>
  <source_thread_id>019e9b54-7344-7a51-86a8-db3d2e3db02b</source_thread_id>
  <input>You are executing `2026-06-06-claude-code-source/R2-post-rework-review`.

Use `codex-session-orchestrator`, `mainline`, and `superpowers:verification-before-completion`.

Goal:
`2026-06-06-claude-code-source: R2 - Independently review C1 private Claude Code adapter rework`

First action: call `create_goal` with that objective.

Boundary:
- This is a review-session, not an implementation worker.
- Findings only. Do not edit product code, tests, package files, release config, installed CLI state, or global skills.
- Allowed write: `docs/workflows/2026-06-06-claude-code-source/handoffs/R2-post-rework-review.md`.
- Do not commit, seal, push, PR, release, install, or update global skills.
- Do not ingest, copy, quote, or commit real Claude transcript content.
- Use original W1B canonical handoff only; ignore W1B replacement evidence.

Report first:
- `pwd`, repo root, branch/detached, HEAD, `git status --short`
- whether C1 commit `55c0638bcab28ee431b7ca70f145615e07d25f69` is reachable in this worktree

Read:
- `AGENTS.md`
- `docs/ROADMAP.md`
- `docs/workflows/2026-06-06-claude-code-source/README.md`
- `docs/workflows/2026-06-06-claude-code-source/workflow-state.md`
- `docs/workflows/2026-06-06-claude-code-source/operating-rules.md`
- `docs/workflows/2026-06-06-claude-code-source/verification-runbook.md`
- `docs/workflows/2026-06-06-claude-code-source/C1-acceptance-checklist.md`
- `docs/workflows/2026-06-06-claude-code-source/tasks/R2-post-rework-review.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/C1-private-adapter-rework.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/W1B-private-adapter-review.md`
- C1 diff: `git show --stat --patch 55c0638bcab28ee431b7ca70f145615e07d25f69`

Review focus:
1. Does C1 fully fix W1B P1 selector/source mismatch before inventory/snapshot/sync/coverage/count/prune mutation?
2. Do skipped/meta/sidechain/tool/thinking/attachment records remain unable to affect identity, cwd, timestamps, searchable text, inventory grouping, fingerprints, coverage freshness, or read projections?
3. Is `claude-code` still private/non-public with public CLI/docs/skill/package surfaces not accepting or claiming it?
4. Did C1 preserve default Codex behavior and avoid current-main parser/snippet/format drift?
5. Are fixtures synthetic only, with no real Claude transcript content?
6. Are tests/smokes adequate enough to proceed to V1?

Expected handoff:
Write `docs/workflows/2026-06-06-claude-code-source/handoffs/R2-post-rework-review.md`.
Findings first, ordered by severity. If no blocker is found, say so explicitly.
Include commands/readbacks, W1B P1 status, public-boundary status, test adequacy,
residual risks, recommendation to proceed/block V1, noise_events,
efficiency_notes, and tool_fit.</input>
</codex_delegation>
```
