# Controller Checkpoint

status: active-paused
controller_thread_id: `019e9b54-7344-7a51-86a8-db3d2e3db02b`
controller_worktree: `/Users/envvar/.codex/worktrees/4b9e/cxs`
controller_branch: `codex/claude-code-source-controller`
mainline_intent: `int_c0ac32dc`

## Current State

The workflow is paused before launching C1. The controller may continue
control-plane preparation only. It must not start workers, commit, seal, push,
release, install, or update global skills until the user lifts the pause.

Wave 1 has been reconciled:

- W1A established that `1a080b1` can be replayed onto latest main from a Git
  conflict standpoint.
- W1B established P1 risks in selector/source integrity and skipped-record
  metadata handling.
- Controller synthesis decided not to promote, merge, release, or install
  `1a080b1` as-is.

## Canonical Files

- `README.md`: workflow purpose, objective, and high-level boundary.
- `operating-rules.md`: active controller rules and pause semantics.
- `workflow-state.md`: live status and state log.
- `session-registry.md`: task/thread registry and noise accounting.
- `milestone-plan.md`: gated path from C1 through install smoke.
- `completion-audit.md`: full-goal requirement matrix; currently incomplete.
- `verification-runbook.md`: concrete proof contracts for each gate.
- `C1-acceptance-checklist.md`: controller checklist for future C1 handoff.
- `tasks/C1-private-adapter-rework.md`: next implementation slice contract.
- `prompts/C1-private-adapter-rework.md`: starter prompt for C1, not yet used.
- `templates/C1-handoff-template.md`: expected C1 handoff structure.
- `handoffs/W1A-truth-reconciliation.md`: canonical W1A evidence.
- `handoffs/W1B-private-adapter-review.md`: canonical W1B evidence from the
  original W1B thread.
- `handoffs/controller-wave1-synthesis.md`: reconciled Wave 1 decision.

## Noise Accounting

- Original W1A appeared after replacement W1A was launched; controller told the
  original to stop.
- Replacement W1B was launched prematurely. It has been cancelled and is not
  evidence unless original W1B is later proven invalid or unavailable.

## Next Action When Pause Lifts

Launch exactly one worker first: C1 private adapter rework. Use
`prompts/C1-private-adapter-rework.md`.

C1 must:

- start from latest main `b82d052e8af9d0460cf73f82e587d84b969500b9`;
- rework private Claude adapter material from `1a080b1`;
- fix W1B P1 selector/source and metadata/privacy issues;
- preserve current Codex behavior and current-main parser/snippet/format fixes;
- keep public CLI rejecting `claude-code`;
- use synthetic fixtures only;
- return `handoffs/C1-private-adapter-rework.md` with proof.

Do not launch R2/V1/D1/S1/L1/P1/I1 until C1 handoff and proof are reconciled.

## Current Dirty Scope

Expected dirty scope at this checkpoint is workflow control-plane only:

- tracked edits under `docs/workflows/2026-06-06-claude-code-source/`
- untracked workflow artifacts in that same workflow directory, including
  handoffs, task, prompt, milestone, operating-rule, audit, runbook, checklist,
  and template files

Any dirty product files should be treated as unexpected until inspected.
