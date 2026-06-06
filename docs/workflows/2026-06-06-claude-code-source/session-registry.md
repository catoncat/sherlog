# Session Registry

| Task | Thread | Worktree | Branch | Commit | Status | Proof | Handoff | Next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W1A | `019e9b59-30ed-7862-b092-90c487543e73` | `/Users/envvar/.codex/worktrees/2034/cxs` | detached | none | reconciled | handoff read | `handoffs/W1A-truth-reconciliation.md` | use synthesis |
| W1B | `019e9b58-31fd-7b00-9c7d-c6085e9cf25c` | `/Users/envvar/.codex/worktrees/eaa1/cxs` | detached at `783e17a` | none | reconciled | handoff read | `handoffs/W1B-private-adapter-review.md` | use synthesis |
| Wave 1 synthesis | controller | `/Users/envvar/.codex/worktrees/4b9e/cxs` | `codex/claude-code-source-controller` | none | reconciled | W1A/W1B reconciled | `handoffs/controller-wave1-synthesis.md` | C1 launched |
| C1 | `019e9c11-bf21-7921-8128-9123ef439c61` | `/Users/envvar/.codex/worktrees/35c5/cxs` | `codex/claude-code-source-C1` | pending | active | thread resolved from pending `local:65ba3b0c-539f-4085-9581-4cc10522cbba` | `handoffs/C1-private-adapter-rework.md` | wait for handoff |
| Milestone plan | controller | `/Users/envvar/.codex/worktrees/4b9e/cxs` | `codex/claude-code-source-controller` | none | planned | gate map written | `milestone-plan.md` | launch C1 first when boundary lifts |
| Operating rules | controller | `/Users/envvar/.codex/worktrees/4b9e/cxs` | `codex/claude-code-source-controller` | none | active | pause and evidence rules written | `operating-rules.md` | keep in force until boundary changes |
| Controller checkpoint | controller | `/Users/envvar/.codex/worktrees/4b9e/cxs` | `codex/claude-code-source-controller` | none | active-paused | rollover handoff written | `handoffs/controller-checkpoint.md` | use for controller recovery |
| Completion audit | controller | `/Users/envvar/.codex/worktrees/4b9e/cxs` | `codex/claude-code-source-controller` | none | incomplete | requirements matrix written | `completion-audit.md` | update after each gate |
| Verification runbook | controller | `/Users/envvar/.codex/worktrees/4b9e/cxs` | `codex/claude-code-source-controller` | none | planned | proof contracts written | `verification-runbook.md` | use for every gate |
| C1 acceptance checklist | controller | `/Users/envvar/.codex/worktrees/4b9e/cxs` | `codex/claude-code-source-controller` | none | planned | reconciliation checklist written | `C1-acceptance-checklist.md` | use after C1 handoff |
| C1 handoff template | controller | `/Users/envvar/.codex/worktrees/4b9e/cxs` | `codex/claude-code-source-controller` | none | planned | handoff template written | `templates/C1-handoff-template.md` | C1 worker should use |

## Registry Rules

- Replace `TBD` with actual thread id, worktree, and branch after launch.
- Read-only tasks do not commit or seal.
- A task is not verified until the controller has read its compact handoff and checked the referenced evidence.
- Worker transcripts are exceptional evidence; prefer handoffs and command/file proof.

## Noise

- Original W1A thread `019e9b57-e526-77c3-9499-540c926668e0` appeared after a replacement launch; controller instructed it to stop and keep no handoff writes.
- W1B replacement thread `019e9b5e-765c-7ab1-91c2-cdb5341f8f76` was launched prematurely while original W1B was still active and had already produced useful risk findings in thread updates. Ignore replacement output unless original W1B fails, goes abnormal, stops updating, crosses scope, or explicitly cannot write a handoff.
- Original W1B produced the canonical handoff after correction. Replacement W1B remains cancelled/ignored and is not part of the evidence set.
