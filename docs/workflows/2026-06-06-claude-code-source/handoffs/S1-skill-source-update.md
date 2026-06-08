# S1 Skill Source Update Handoff

task_id: `S1-skill-source-update`
thread_id: `019e9c7a-42f5-7022-854f-c635286dfd09`
cwd: `/Users/envvar/.codex/worktrees/c2b0/cxs`
head: `55c0638bcab28ee431b7ca70f145615e07d25f69`
status: `pass`

## Conclusion

S1 passes. The distributable skill source under `skill-packages/sherlog` now matches
D1's verified checkout wording:

- public CLI source remains `codex` only;
- `--source codex` remains optional / default;
- `claude-code` is described as a private / non-public checkout adapter path
  for synthetic verification and future promotion work;
- the skill does not claim public `shlog sync --source claude-code`, npm release,
  installed PATH CLI support, global skill update, or stable public Claude raw
  JSONL format.

L1 can begin from the skill-source perspective. S1 does not unlock release,
install, global skill update, commit, seal, push, PR, npm publish, or public
Claude Code source promotion.

## Files Changed

- `skill-packages/sherlog/SKILL.md`
- `skill-packages/sherlog/references/cli-surface.md`
- `skill-packages/sherlog/references/failure-cookbook.md`
- `skill-packages/sherlog/references/json-schema.md`
- `skill-packages/sherlog/references/progressive-workflow.md`
- `docs/workflows/2026-06-06-claude-code-source/handoffs/S1-skill-source-update.md`

## Skill Wording Decisions

- Replaced the stale "reserved/non-public" shorthand with the more precise D1
  state: source checkout has a private / non-public `claude-code` adapter path.
- Kept the public skill guidance operationally Codex-only: normal agents should
  omit `--source` or use `--source codex`.
- Explicitly says the private checkout path is not a public CLI promise, not a
  release/install/global skill proof, not guidance to read raw Claude files, and
  not a stable public raw JSONL format decision.
- Left dogfood/dev-only workflow and private goldens out of the public skill
  source, except for the existing user-triggered `$sherlog-dogfood` self-eval
  guidance that was already present.

## Proof Commands

```text
$ git diff -- skill-packages/sherlog
exit 0; showed changes only in:
skill-packages/sherlog/SKILL.md
skill-packages/sherlog/references/cli-surface.md
skill-packages/sherlog/references/failure-cookbook.md
skill-packages/sherlog/references/json-schema.md
skill-packages/sherlog/references/progressive-workflow.md

$ npx skills ls -g --json
exit 0; global skill list includes `Sherlog` at /Users/envvar/.agents/skills/cxs.
This only proves global skill presence, not that it has been updated from this
checkout.

$ git diff --check
exit 0

$ npm run shlog -- --help
exit 0; commands listed: status, sync, find, read-range, read-page, list, stats,
help.

$ npm run shlog -- status --help
exit 0; status options include `--source <id>      session source (public:
codex)`.

$ npm run shlog -- status --source claude-code --json
exit 1 by design; JSON error.code `unsupported_source`, source `claude-code`,
message says only `codex` is public in this release.
```

## Setup Note

Initial CLI help smokes failed with `tsx: command not found` because this
isolated worktree did not have dependencies installed. Ran `npm ci` locally;
it added `node_modules` only and did not change package metadata or lockfiles.
After that, required CLI smokes passed / failed by design as listed above.

## Release And Install Statements

- Source layer: `skill-packages/sherlog` was updated in this checkout only.
- Skill publication layer: global `Sherlog` skill was not updated. No `npx skills
  add catoncat/sherlog ...` install/update was run.
- CLI publication layer: no package version bump, npm publish, release workflow,
  tag, or registry update was performed.
- Local installed CLI layer: installed PATH `Sherlog` was not modified or validated
  as updated from this checkout.

## Missing Or Weak Evidence

- S1 did not run `npm run check`; this was skill-source wording only, and the
  required proof was skill diff plus CLI help/readback and whitespace check.
- S1 did not prove the globally installed skill source matches this checkout.
- S1 did not prove npm registry, release workflow, PATH CLI, or global skill
  state.

## Noise Events

- The expected controller-control-plane files `tasks/S1-skill-source-update.md`
  and `handoffs/V1-verification.md` were absent in this fork; controller
  clarification explicitly authorized continuing because C1 source files and D1
  docs/handoff were present.
- `mainline preflight --json` returned `inspect_or_stop` due to known overlaps
  with the earlier private adapter proposal and selector-root docs proposal.
  Both were inspected and classified as existing workflow context, not a new
  S1 conflict.

## Efficiency Notes

- Kept edits to five public skill package files plus this handoff.
- Did not touch product code, tests, public docs outside the skill package,
  package/lock/release/CI files, installed CLI, global skill state, real Claude
  transcript content, commits, seals, pushes, PRs, npm publish, or release
  state.
- Reused D1 wording and C1/V1 readbacks instead of reopening broad source
  design.

## Tool Fit

- `mainline`: fit for intent overlap inspection, but lifecycle advancement was
  intentionally not used because S1 forbids commit/seal/push/PR.
- `skill-creator`: partially fit as a reminder to keep the existing skill
  precise and progressively disclosed; no broad skill eval loop was needed.
- `verification-before-completion`: fit; final status is based on fresh proof
  commands, including the expected nonzero `unsupported_source` smoke.
