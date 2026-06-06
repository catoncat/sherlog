# C1 Acceptance Checklist

status: `planned`

Use this checklist when the pause is lifted, C1 has run, and the controller is
reconciling `handoffs/C1-private-adapter-rework.md`. It is not a worker launch
instruction and is not evidence by itself.

## Required Inputs

- `handoffs/C1-private-adapter-rework.md`
- C1 final message, if it contains proof not copied into the handoff
- `verification-runbook.md`
- `completion-audit.md`
- current `git status --short --untracked-files=all` in the C1 worktree

## Hard Fail Conditions

Reject C1 and do not launch R2/V1 if any item is true:

- C1 used, copied, quoted, or committed real Claude transcript content.
- Public CLI, docs, skill source, package metadata, or release notes claim
  public Claude Code support.
- `--source claude-code` is accepted by the public CLI before an explicit public
  promotion slice.
- Selector JSON requesting public `claude-code` is accepted before promotion.
- Any W1B P1 finding is unaddressed or only explained without a test/proof.
- Current-main Codex behavior, parser truncation, snippet, or format behavior
  regressed.
- Product changes exist outside C1's intended private adapter/test scope without
  explanation.
- Required proof commands did not run and no acceptable blocker is recorded.

## Review Items

Mark each item `pass`, `fail`, or `unknown` while reconciling C1.

| Item | Expected Evidence | Result |
| --- | --- | --- |
| Worktree identity recorded | `pwd`, repo root, branch/detached, HEAD, `git status --short` in handoff | pending |
| Latest-main basis confirmed | C1 states whether it started from `b82d052e8af9d0460cf73f82e587d84b969500b9` or explains rebase/cherry-pick basis | pending |
| Selector/source mismatch fixed | focused test and code summary show mismatch rejected before Claude inventory/snapshot/sync/coverage/count/prune | pending |
| Parser skipped-record metadata fixed | focused test shows skipped/meta/sidechain-first records cannot set session identity, `cwd`, timestamps, or read projections | pending |
| Inventory skipped-record metadata fixed | focused test shows skipped/meta/sidechain records cannot set inventory grouping, fingerprints, or coverage freshness | pending |
| Search/read privacy fixed | synthetic sentinel strings from skipped records absent from searchable/read projections | pending |
| Public CLI rejection preserved | CLI smoke and tests show `--source claude-code` rejected | pending |
| Public selector rejection preserved | CLI smoke and tests show selector JSON requesting `claude-code` rejected | pending |
| Codex default behavior preserved | focused regression test or smoke for default Codex path | pending |
| Current-main drift avoided | C1 identifies preservation of parser truncation and snippet/format fixes | pending |
| Synthetic fixture only | C1 describes fixture source and confirms no real transcript content | pending |
| Timeout changes justified | C1 explains no timeout changes or gives evidence for scoped changes | pending |
| `npm run check` passed | command and decisive result in handoff | pending |
| `git diff --check` passed | command and decisive result in handoff | pending |
| Final dirty scope known | final `git status --short` in handoff | pending |

## Controller Decision

After filling the table:

- If every hard fail condition is absent and all review items are `pass`, record
  C1 as `reconciled` in `session-registry.md`, update `completion-audit.md`, and
  launch R2 only if the user boundary allows new workers.
- If any item is `fail`, keep C1 open or launch a follow-up fix slice only after
  the user boundary allows workers.
- If any item is `unknown`, collect the missing proof from the C1 thread/handoff
  before deciding.

Do not treat C1 as full-goal completion. Even a passing C1 only unlocks R2.
