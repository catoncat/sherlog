# D1 Public Docs And Contract Update

Mode: `implementation-slice`

Status: `planned`

## Objective

Update public current-state docs and contract wording after V1 passed for C1
commit `55c0638bcab28ee431b7ca70f145615e07d25f69`.

D1 must make docs match verified checkout behavior while keeping `claude-code`
private/non-public. D1 does not update the public skill source, package
metadata, release notes, installed CLI, registry, or global skill state.

## Required Reads

- `AGENTS.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/INDEX_COVERAGE_DESIGN.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/C1-private-adapter-rework.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/R2-post-rework-review.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/V1-verification.md`
- `docs/workflows/2026-06-06-claude-code-source/verification-runbook.md`
- `docs/workflows/2026-06-06-claude-code-source/completion-audit.md`

If the worker checkout lacks the latest controller handoffs, use the controller
prompt as task authority and record the drift in the handoff.

## Allowed Writes

- Current-state public docs that describe source architecture, command surface,
  coverage, roadmap, and verified checkout behavior.
- `docs/workflows/2026-06-06-claude-code-source/handoffs/D1-docs-contract-update.md`

## Forbidden

- `skill-packages/cxs/**`
- `package.json`, lockfiles, release config, CI, build config, installed CLI
  state, global skills
- Product code and tests, unless a docs test file already exists and must be
  updated to keep docs checks passing
- Real Claude transcript content in docs, fixtures, command output, or durable
  artifacts
- Commit, Mainline append/seal, push, PR, npm publish, release, local install,
  global skill update

## Required Content Boundaries

- The fixed command surface remains `status`, `sync`, `find`, `read-range`,
  `read-page`, `list`, `stats`.
- Public CLI source remains `codex` only.
- `claude-code` may be described only as a private/non-public adapter or future
  promotion candidate verified through synthetic programmatic smokes.
- Do not claim registry release, installed PATH behavior, or global skill
  behavior includes C1/V1 changes.
- Preserve source checkout, skill source, npm registry CLI, local PATH CLI, and
  global skill as separate layers.
- Do not present raw Claude JSONL support as a stable public format decision.

## Required Proof

```bash
git diff -- docs README.md AGENTS.md skill-packages/cxs 2>/dev/null || true
git diff --check
```

Also run docs-relevant checkout help/readback if docs quote or paraphrase CLI
help:

```bash
npm run cxs -- --help
npm run cxs -- sync --help
npm run cxs -- find --help
npm run cxs -- status --source claude-code --json
```

Run `npm run check` only if docs changes affect code-linked tests or if the
worker needs fresh evidence before recommending S1.

## Expected Handoff

Write `docs/workflows/2026-06-06-claude-code-source/handoffs/D1-docs-contract-update.md`
with:

- task_id, thread_id, cwd, branch, head
- conclusion: pass, fail, or incomplete
- files changed
- public/private wording decisions
- release/install boundary statements
- exact proof commands and decisive results
- whether S1 skill-source update can begin
- missing/weak evidence
- noise_events, efficiency_notes, tool_fit

D1 passing only unlocks S1 skill-source update. It does not unlock lifecycle,
release, install, or global skill update.
