# V1 Verification Gate

Mode: `evidence-session`

Status: `planned`

## Objective

Verify C1 commit `55c0638bcab28ee431b7ca70f145615e07d25f69` after R2 review
found no unresolved P1. V1 proves the current checkout behavior is good enough
to unlock public docs and skill-source work; it does not promote, publish,
release, install, or update global skills.

## Required Reads

- `AGENTS.md`
- `docs/ROADMAP.md`
- `docs/workflows/2026-06-06-claude-code-source/README.md`
- `docs/workflows/2026-06-06-claude-code-source/workflow-state.md`
- `docs/workflows/2026-06-06-claude-code-source/operating-rules.md`
- `docs/workflows/2026-06-06-claude-code-source/verification-runbook.md`
- `docs/workflows/2026-06-06-claude-code-source/completion-audit.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/C1-private-adapter-rework.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/R2-post-rework-review.md`

If the worker checkout lacks the latest controller handoffs, use the controller
prompt as task authority and record that drift in the handoff.

## Verification Scope

- Current checkout behavior at C1 commit `55c0638`.
- Public Codex-only CLI boundary.
- Private synthetic Claude adapter path.
- Existing Codex default behavior.
- Test timeout and fixture policy.
- Worktree cleanliness after evidence collection.

## Required Commands

Run from the C1 implementation checkout unless the controller gives a different
verified implementation checkout:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current || true
git rev-parse HEAD
git status --short --untracked-files=all
npm run check
npm run shlog -- --help
npm run shlog -- status --json
npm run shlog -- status --source claude-code --json
npm run shlog -- sync --selector '{"source":"claude-code","kind":"all","root":"<tmp>"}' --db <tmp>/index.sqlite --json
git diff --check
git status --short --untracked-files=all
```

For commands expected to fail by design, record the nonzero exit status and the
structured error summary.

## Required Focused Smokes

- Codex default smoke using the current checkout and a synthetic/temp Codex
  selector or the smallest safe existing checkout status/list/read path.
- Public rejection smoke for `claude-code` through both `--source` and selector
  JSON.
- Private synthetic Claude fixture sync/read/search smoke proving accepted
  synthetic records can be indexed and skipped synthetic sentinels do not leak
  into search/read projections or metadata.
- Confirm no C1 timeout increase remains, or record the scoped evidence if one
  exists.

## Allowed Writes

- `docs/workflows/2026-06-06-claude-code-source/handoffs/V1-verification.md`
- Optional temp artifacts outside the repo or under an ignored temp directory.

## Forbidden

- Product code, tests, package files, public docs, public skill source, release
  config, installed CLI state, global skills, real transcript fixtures.
- Commit, Mainline append/seal, push, PR, npm publish, release workflow, local
  CLI install, or global skill update.
- Real Claude transcript content in fixtures, command output, or durable
  artifacts.

## Expected Handoff

Write `docs/workflows/2026-06-06-claude-code-source/handoffs/V1-verification.md`
with:

- task_id, thread_id, cwd, branch, head, reviewed_commit
- conclusion: pass, fail, or incomplete
- requirement-to-proof matrix
- exact command results and decisive outputs
- Codex default smoke result
- public Claude rejection smoke results
- private synthetic Claude smoke result
- timeout/fixture policy review
- final dirty status
- missing/weak evidence
- recommendation: unlock D1 or block with required fix
- noise_events, efficiency_notes, tool_fit

Do not call the whole goal complete. A passing V1 only unlocks D1 public docs
and contract update.
