# Operating Rules

status: `active`

These rules govern the `2026-06-06-claude-code-source` controller workflow.
They are control-plane rules only; product behavior remains governed by code,
tests, project docs, and Mainline evidence.

## Controller Role

- The controller owns workflow state, task boundaries, prompt packets, handoff
  reconciliation, proof checks, lifecycle gates, and closeout.
- The controller does not implement product code, tests, package changes,
  release config, installed CLI state, or global skill changes.
- Product implementation, review, verification, docs, skill, release, and
  install work belongs to bounded worker sessions after the current pause is
  lifted.

## Current Boundary

The latest active goal continuation has lifted the old pre-C1 pause. Current
boundary:

- Do not start replacement workers for already reconciled W1/C1 work.
- C1 is complete and reconciled; do not relaunch it.
- R2 post-rework review may be launched against C1 commit `55c0638`.
- Do not commit, Mainline append/seal, push, PR, release, install, or update
  global skills unless the specific lifecycle gate is reached and authorized.
- Control-plane edits are allowed when they clarify state, reduce future
  coordination risk, prepare a launch packet, or reconcile worker handoffs.

Do not treat an automatic Goal continuation as full release authorization. It
does authorize concrete progress through the next evidence gate when the prior
gate is proven.

## Evidence Rules

- Canonical evidence lives in this workflow directory and the named worker
  handoffs.
- Prefer compact handoffs and command/file proof over transcript reads.
- Read worker transcripts only for missing state, contradictory evidence,
  abnormal lifecycle state, or process forensics.
- Original W1B thread `019e9b58-31fd-7b00-9c7d-c6085e9cf25c` is the canonical
  W1B review source.
- W1B replacement thread `019e9b5e-765c-7ab1-91c2-cdb5341f8f76` is cancelled
  noise. Do not use its findings unless original W1B is later proven invalid or
  unavailable.

## Source And Privacy Rules

- `1a080b1abf8e75dd9ecba607af4dca7c7141b3fb` is a private spike, not released
  behavior.
- `claude-code` stays private/non-public until public promotion is explicitly
  verified.
- Do not ingest, copy, quote, or commit real Claude transcript content into
  fixtures or durable workflow artifacts.
- Public CLI behavior remains Codex-only until a later promotion slice changes
  it after passing review and verification.

## Launch Rules

Current launch sequence:

1. C1 is already reconciled at `55c0638`; do not relaunch it.
2. Launch `R2-post-rework-review` next.
3. Require a compact handoff at `handoffs/R2-post-rework-review.md`.
4. Do not pre-launch V1, docs, skill, release, or install workers.
5. Advance later milestones only after reading the prior handoff and checking
   the proof named in `milestone-plan.md`.

## Release And Install Rules

- Keep source checkout, skill source, npm registry CLI, and local PATH CLI as
  separate layers.
- Do not report source changes as released without registry readback.
- Do not report local CLI installed state without `command -v cxs`,
  `which -a cxs`, `cxs --version`, and a real installed smoke such as
  `cxs status --json`.
- Do not update global `cxs` skill from dirty checkout or local symlink.
