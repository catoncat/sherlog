# Session Registry

| Task | Thread | Worktree | Branch | Commit | Status | Proof | Handoff | Next |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W1A | pending `local:6d326344-134f-4b64-8e51-ce1a5d78adcd` | pending | pending | none | launching | pending | `handoffs/W1A-truth-reconciliation.md` | resolve thread id |
| W1B | pending `local:f2298802-b5fe-4d6d-8c34-d688e58d61b4` | pending | pending | none | launching | pending | `handoffs/W1B-private-adapter-review.md` | resolve thread id |

## Registry Rules

- Replace `TBD` with actual thread id, worktree, and branch after launch.
- Read-only tasks do not commit or seal.
- A task is not verified until the controller has read its compact handoff and checked the referenced evidence.
- Worker transcripts are exceptional evidence; prefer handoffs and command/file proof.
