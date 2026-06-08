# S1 Skill Source Update Starter Prompt

```text
<codex_delegation>
  <source_thread_id>019e9b54-7344-7a51-86a8-db3d2e3db02b</source_thread_id>
  <input>You are executing `2026-06-06-claude-code-source/S1-skill-source-update`.

Use `codex-session-orchestrator`, `mainline`, and `superpowers:verification-before-completion`.

Goal:
`2026-06-06-claude-code-source: S1 - Align distributable sherlog skill source after D1`

First action: call `create_goal` with that objective.

Boundary:
- This is an implementation-slice for `skill-packages/sherlog` only.
- Do not edit product code/tests, package files, release config, installed CLI state, or global skills.
- Allowed handoff write: `docs/workflows/2026-06-06-claude-code-source/handoffs/S1-skill-source-update.md`.
- Do not commit, seal, push, PR, npm publish, release, local install, or update global skills.
- Do not ingest, copy, quote, or commit real Claude transcript content.

Important checkout context:
- Work on a checkout that includes the C1 implementation files (for example `src/sources/claude-code.ts`, `src/sources/claude-code-parser.ts`, and `src/sources/registry.ts`) plus the D1 docs changes.
- Historical reference: the original S1 worker ran after C1 worker commit `55c0638bcab28ee431b7ca70f145615e07d25f69`, but a later checkout does not need that exact commit hash as long as the same implementation and D1 docs are present.
- If your checkout lacks D1 docs/handoff or C1 files such as `src/sources/claude-code.ts`, stop and report stale checkout.
- Public CLI source remains `codex` only. `claude-code` remains private/non-public.

Read:
- `AGENTS.md`
- `skill-packages/sherlog/SKILL.md`
- `skill-packages/sherlog/references/cli-surface.md`
- `skill-packages/sherlog/references/failure-cookbook.md`
- `skill-packages/sherlog/references/json-schema.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/workflows/2026-06-06-claude-code-source/tasks/S1-skill-source-update.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/D1-docs-contract-update.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/V1-verification.md`

Work:
Update `skill-packages/sherlog` so the distributable skill source matches verified checkout behavior:
- skill install does not install the CLI;
- fixed command surface remains `status`, `sync`, `find`, `read-range`, `read-page`, `list`, `stats`;
- public CLI source remains `codex` only;
- `claude-code` may be described only as private/non-public checkout adapter behavior and future promotion candidate;
- do not claim npm registry, installed PATH CLI, or global skill state has changed;
- keep dogfood/dev-only capture and private goldens out of public skill source;
- do not present raw Claude JSONL as a stable public format decision.

Required proof:
- `git diff -- skill-packages/sherlog`
- `npx skills ls -g --json`
- `git diff --check`
- If skill text quotes/paraphrases CLI help:
  - `npm run shlog -- --help`
  - `npm run shlog -- status --help`
  - `npm run shlog -- status --source claude-code --json`

Expected handoff:
Write `docs/workflows/2026-06-06-claude-code-source/handoffs/S1-skill-source-update.md`.
Include conclusion, files changed, skill wording decisions, proof commands/results, whether L1 can begin, release/install/global skill statements, missing/weak evidence, noise_events, efficiency_notes, and tool_fit.</input>
</codex_delegation>
```
