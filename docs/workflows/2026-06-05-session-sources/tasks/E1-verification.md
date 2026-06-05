# E1: Verification Evidence

Mode: `evidence-session`

## Objective

Collect final evidence that the multi-source foundation preserves existing Codex behavior and satisfies the design decisions.

## Read Paths

- D1 design packet.
- I1/I2/I3/I4 handoffs.
- Current git diff or committed slice.
- Relevant tests and CLI outputs.

## Allowed Writes

- `docs/workflows/2026-06-05-session-sources/handoffs/E1-verification.md`
- Optional command artifacts under `docs/workflows/2026-06-05-session-sources/handoffs/E1-artifacts/`

## Forbidden

- No source fixes.
- No docs fixes outside handoff.
- No Mainline append, seal, commit, push, PR, release, global skill install, or local CLI install.

## Proof

Run or record why unavailable:

- `npm run check`
- `npm run cxs -- status --json`
- `npm run cxs -- status --source codex --json` if implemented
- one focused `find` or `list` smoke using checkout CLI
- `git status --short`

## Expected Output

Evidence matrix mapping each explicit D1 requirement to proof, weak proof, or missing proof.

## Escalation

Stop and mark missing proof if checks are too narrow to prove a broad claim.

