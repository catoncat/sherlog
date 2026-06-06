# Session Registry

| Task | Thread | Worktree | Branch | Commit | Status | Proof | Handoff | Next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W1A | `019e9b59-30ed-7862-b092-90c487543e73` | `/Users/envvar/.codex/worktrees/2034/cxs` | pending | none | active | pending | `handoffs/W1A-truth-reconciliation.md` | wait for handoff |
| W1B | `019e9b58-31fd-7b00-9c7d-c6085e9cf25c` | `/Users/envvar/.codex/worktrees/eaa1/cxs` | detached at `783e17a` | none | active | pending | `handoffs/W1B-private-adapter-review.md` | wait for handoff |

## Registry Rules

- Replace `TBD` with actual thread id, worktree, and branch after launch.
- Read-only tasks do not commit or seal.
- A task is not verified until the controller has read its compact handoff and checked the referenced evidence.
- Worker transcripts are exceptional evidence; prefer handoffs and command/file proof.

## Noise

- Original W1A thread `019e9b57-e526-77c3-9499-540c926668e0` appeared after a replacement launch; controller instructed it to stop and keep no handoff writes.
