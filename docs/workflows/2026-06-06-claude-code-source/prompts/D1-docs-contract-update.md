# D1 Docs Contract Update Starter Prompt

```text
<codex_delegation>
  <source_thread_id>019e9b54-7344-7a51-86a8-db3d2e3db02b</source_thread_id>
  <input>You are executing `2026-06-06-claude-code-source/D1-docs-contract-update`.

Use `codex-session-orchestrator`, `mainline`, and `superpowers:verification-before-completion`.

Goal:
`2026-06-06-claude-code-source: D1 - Update public docs and contract wording after V1`

First action: call `create_goal` with that objective.

Boundary:
- This is an implementation-slice for docs/contract only.
- Do not edit product code, tests, `skill-packages/sherlog/**`, package files, release config, installed CLI state, or global skills.
- Allowed handoff write: `docs/workflows/2026-06-06-claude-code-source/handoffs/D1-docs-contract-update.md`.
- Do not commit, seal, push, PR, npm publish, release, local install, or update global skills.
- Do not ingest, copy, quote, or commit real Claude transcript content.

Important branch context:
- Source behavior verified by V1 is C1 commit `55c0638bcab28ee431b7ca70f145615e07d25f69`.
- Expected implementation checkout should contain C1 product changes. If your checkout lacks C1 files such as `src/sources/claude-code.ts`, stop and report stale checkout.
- Controller handoffs R2/V1 may not be present in your branch. Use this prompt as task authority if needed.

Read:
- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/INDEX_COVERAGE_DESIGN.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/C1-private-adapter-rework.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/R2-post-rework-review.md`, if present
- `docs/workflows/2026-06-06-claude-code-source/handoffs/V1-verification.md`, if present
- `docs/workflows/2026-06-06-claude-code-source/tasks/D1-docs-contract-update.md`, if present

Work:
Update current-state public docs so they match verified checkout behavior:
- fixed command surface stays `status`, `sync`, `find`, `read-range`, `read-page`, `list`, `stats`
- public CLI source remains `codex` only
- `claude-code` may be mentioned only as private/non-public/future, verified by synthetic programmatic smoke, not public support
- separate source checkout, skill source, npm registry CLI, local PATH CLI, and global skill layers
- do not claim registry release, installed PATH behavior, or global skill state has changed
- do not present raw Claude JSONL as a stable public format decision

Required proof:
- `git diff -- docs README.md AGENTS.md skill-packages/sherlog 2>/dev/null || true`
- `git diff --check`
- If docs mention CLI help/options, run relevant help/readback:
  - `npm run shlog -- --help`
  - `npm run shlog -- sync --help`
  - `npm run shlog -- find --help`
  - `npm run shlog -- status --source claude-code --json`

Expected handoff:
Write `docs/workflows/2026-06-06-claude-code-source/handoffs/D1-docs-contract-update.md`.
Include conclusion, files changed, wording decisions, release/install boundary statements, proof commands/results, whether S1 can begin, missing/weak evidence, noise_events, efficiency_notes, and tool_fit.</input>
</codex_delegation>
```
