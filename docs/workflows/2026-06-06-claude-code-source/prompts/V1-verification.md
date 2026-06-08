# V1 Verification Starter Prompt

```text
<codex_delegation>
  <source_thread_id>019e9b54-7344-7a51-86a8-db3d2e3db02b</source_thread_id>
  <input>You are executing `2026-06-06-claude-code-source/V1-verification`.

Use `codex-session-orchestrator`, `mainline`, and `superpowers:verification-before-completion`.

Goal:
`2026-06-06-claude-code-source: V1 - Verify C1 private Claude Code adapter checkout behavior`

First action: call `create_goal` with that objective.

Boundary:
- This is an evidence-session, not an implementation worker.
- Verify current checkout behavior at C1 commit `55c0638bcab28ee431b7ca70f145615e07d25f69`.
- Do not edit product code, tests, package files, public docs, public skill source, release config, installed CLI state, or global skills.
- Allowed write: `docs/workflows/2026-06-06-claude-code-source/handoffs/V1-verification.md`.
- Do not commit, seal, push, PR, npm publish, release, local install, or update global skills.
- Do not ingest, copy, quote, or commit real Claude transcript content.

Important branch context:
- Expected implementation checkout is branch `codex/claude-code-source-C1` at commit `55c0638bcab28ee431b7ca70f145615e07d25f69`.
- Controller commit `601ead68e85a05628e5dbd0b31073247d1e6650e` and later R2 control-plane edits may not be ancestors of this worker checkout. If local task/handoff files are stale, use this prompt as task authority and record the drift.
- R2 handoff concluded no unresolved P1 and recommends V1.

Report first:
- `pwd`, repo root, branch/detached, HEAD, `git status --short --untracked-files=all`
- whether HEAD equals or contains C1 commit `55c0638bcab28ee431b7ca70f145615e07d25f69`

Read if present:
- `AGENTS.md`
- `docs/ROADMAP.md`
- `docs/workflows/2026-06-06-claude-code-source/README.md`
- `docs/workflows/2026-06-06-claude-code-source/verification-runbook.md`
- `docs/workflows/2026-06-06-claude-code-source/completion-audit.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/C1-private-adapter-rework.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/R2-post-rework-review.md`, if present

Required verification:
1. `npm run check`
2. `npm run shlog -- --help`
3. `npm run shlog -- status --json`
4. public rejection smoke: `npm run shlog -- status --source claude-code --json`
5. public selector rejection smoke: `npm run shlog -- sync --selector '{"source":"claude-code","kind":"all","root":"<tmp>"}' --db <tmp>/index.sqlite --json`
6. Codex default smoke using synthetic/temp data or smallest safe current-checkout path.
7. Private synthetic Claude fixture sync/read/search smoke. Use generated temp JSONL only; prove accepted synthetic records index/read and skipped synthetic sentinels do not leak into search/read projections or metadata.
8. Confirm no timeout increase remains, or record scoped evidence if one exists.
9. `git diff --check`
10. final `git status --short --untracked-files=all`

Expected handoff:
Write `docs/workflows/2026-06-06-claude-code-source/handoffs/V1-verification.md`.
Include conclusion pass/fail/incomplete, requirement-to-proof matrix, command results, smoke evidence, timeout/fixture review, final dirty status, missing/weak evidence, recommendation to unlock D1 or block, noise_events, efficiency_notes, and tool_fit.</input>
</codex_delegation>
```
