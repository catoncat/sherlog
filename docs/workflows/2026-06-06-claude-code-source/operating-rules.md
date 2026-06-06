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
  install work belongs to bounded worker sessions or narrowly scoped controller
  follow-up when a later gate exposes drift.

## Current Boundary

Current gate:

- Do not relaunch W1, C1, R2, V1, D1, or S1. Those slices are already
  reconciled into the controller branch.
- PR #51 is open and ready for review. `test` and Cubic checks are green, but
  review comments still need technical evaluation before merge/release.
- Do not merge, tag, publish, install, or update global skills until the PR is
  accepted and the later release/install gates collect fresh evidence.
- Focus follow-up work on review feedback, proof drift, and control-plane
  accuracy. Avoid reopening completed worker slices unless new evidence proves a
  real regression.
- Control-plane edits are allowed when they clarify state, reduce future
  coordination risk, prepare the next launch packet, or reconcile verified
  review feedback.

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

1. Review-fix the current PR only when live review feedback proves a real issue.
2. Keep worker relaunches exceptional; prefer a local focused fix when the
   issue is small and already understood on the controller branch.
3. Re-run the relevant verification before updating PR state or lifecycle docs.
4. Advance to merge/release only after the PR is accepted and the proof named
   in `milestone-plan.md` stays current.
5. Advance to installed CLI/global skill work only after registry publication
   is proven.

## Release And Install Rules

- Keep source checkout, skill source, npm registry CLI, and local PATH CLI as
  separate layers.
- Do not report source changes as released without registry readback.
- Do not report local CLI installed state without `command -v cxs`,
  `which -a cxs`, `cxs --version`, and a real installed smoke such as
  `cxs status --json`.
- Do not update global `cxs` skill from dirty checkout or local symlink.
