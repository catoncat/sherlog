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

## Current Pause

The latest user correction is the active stop line:

- Do not start new replacement workers.
- Do not launch C1 or any later worker yet.
- Do not commit, Mainline append/seal, push, PR, release, install, or update
  global skills.
- Control-plane edits are allowed when they clarify state, reduce future
  coordination risk, or prepare a launch packet without launching it.

If an automatic Goal continuation arrives, it does not override this pause. The
controller may keep preparing control-plane artifacts, but lifecycle advancement
requires the user to lift the pause explicitly.

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

When the user lifts the pause:

1. Launch only `C1-private-adapter-rework` first.
2. Use `prompts/C1-private-adapter-rework.md` as the worker starter.
3. Require a compact handoff at
   `handoffs/C1-private-adapter-rework.md`.
4. Do not pre-launch R2, V1, docs, skill, release, or install workers.
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
