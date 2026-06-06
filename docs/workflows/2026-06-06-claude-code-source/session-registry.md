# Session Registry

| Task | Thread | Worktree | Branch | Commit | Status | Proof | Handoff | Next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W1A | pending `local:486ec5a5-236c-4984-9749-1df16d8aaccf` | pending | pending | none | launching | pending | `handoffs/W1A-truth-reconciliation.md` | resolve thread id |
| W1B | `019e9b58-31fd-7b00-9c7d-c6085e9cf25c` | `/Users/envvar/.codex/worktrees/eaa1/cxs` | detached at `783e17a` | none | active | pending | `handoffs/W1B-private-adapter-review.md` | wait for handoff |

## Registry Rules

- Replace `TBD` with actual thread id, worktree, and branch after launch.
- Read-only tasks do not commit or seal.
- A task is not verified until the controller has read its compact handoff and checked the referenced evidence.
- Worker transcripts are exceptional evidence; prefer handoffs and command/file proof.
