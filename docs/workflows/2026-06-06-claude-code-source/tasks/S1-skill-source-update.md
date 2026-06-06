# S1 Skill Source Update

Mode: `implementation-slice`

Status: `planned`

## Objective

Update the distributable cxs skill source after D1 has aligned public docs with
verified C1/V1 checkout behavior.

S1 must make `skill-packages/cxs` match the same private/public source boundary:
`codex` remains the only public CLI source, while `claude-code` may be described
only as a private/non-public adapter path in the source checkout and future
promotion candidate. S1 does not release, install, or update the global skill.

## Required Reads

- `AGENTS.md`
- `skill-packages/cxs/SKILL.md`
- `skill-packages/cxs/references/cli-surface.md`
- `skill-packages/cxs/references/failure-cookbook.md`
- `skill-packages/cxs/references/json-schema.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/D1-docs-contract-update.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/V1-verification.md`
- `docs/workflows/2026-06-06-claude-code-source/verification-runbook.md`
- `docs/workflows/2026-06-06-claude-code-source/completion-audit.md`

If the worker checkout lacks the latest D1 docs/handoff, stop and report stale
checkout rather than guessing.

## Allowed Writes

- `skill-packages/cxs/**`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/S1-skill-source-update.md`

## Forbidden

- Product code and tests under `src/**`, `test/**`, or equivalent runtime areas
- Public docs outside `skill-packages/cxs/**`, unless a tiny wording mismatch in
  D1 docs blocks skill consistency and is explicitly reported
- `package.json`, lockfiles, release config, CI, installed CLI state, global
  skills
- Real Claude transcript content in docs, fixtures, command output, or durable
  artifacts
- Commit, Mainline append/seal, push, PR, npm publish, release, local install,
  global skill update

## Required Content Boundaries

- The skill must continue to say it installs workflow guidance only and does
  not install the `cxs` CLI.
- The fixed command surface remains `status`, `sync`, `find`, `read-range`,
  `read-page`, `list`, `stats`.
- Public CLI source remains `codex` only.
- `claude-code` must not be described as a public CLI source or installed
  behavior. It may be called a private/non-public checkout adapter path verified
  with synthetic programmatic smokes.
- Do not tell agents to use raw Claude JSONL as a stable public input format.
- Keep dogfood/dev-only capture and private goldens out of the public skill
  package.
- Keep source checkout, skill source, npm registry CLI, local PATH CLI, and
  global installed skill as separate layers.

## Required Proof

```bash
git diff -- skill-packages/cxs
npx skills ls -g --json
git diff --check
```

Run checkout CLI readbacks if the skill quotes or paraphrases command help:

```bash
npm run cxs -- --help
npm run cxs -- status --help
npm run cxs -- status --source claude-code --json
```

Do not update the global skill from this dirty checkout. Do not run
`npx skills add ...` in S1.

## Expected Handoff

Write `docs/workflows/2026-06-06-claude-code-source/handoffs/S1-skill-source-update.md`
with:

- task_id, thread_id, cwd, branch, head
- conclusion: pass, fail, or incomplete
- files changed
- skill wording decisions
- proof commands and decisive results
- whether L1 lifecycle commit/seal can begin
- release/install/global skill state statements
- missing/weak evidence
- noise_events, efficiency_notes, tool_fit

S1 passing only unlocks L1 lifecycle commit/seal preparation. It does not unlock
push, release, install, or global skill update.
