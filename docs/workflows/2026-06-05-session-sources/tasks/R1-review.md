# R1: Final Review

Mode: `review-session`

## Objective

Review the final design and implementation for source leakage, ID ambiguity, coverage mistakes, docs overclaiming, and release/install boundary drift.

## Read Paths

- D1 design packet.
- I1/I2/I3/I4/E1 handoffs.
- Final diff or commits.
- `src/**`
- `docs/**`
- `skill-packages/cxs/**`

## Allowed Writes

- None by default. Return findings in final.
- If explicitly asked by orchestrator, write only `docs/workflows/2026-06-05-session-sources/handoffs/R1-review.md`.

## Forbidden

- No source fixes.
- No docs fixes.
- No comment resolution, push, PR, release, global skill install, or local CLI install.

## Review Focus

Find:

- Any remaining Codex-only assumption outside Codex adapter.
- Any selector/coverage cross-source leakage.
- Any session ID collision or read command ambiguity.
- Any migration that drops existing Codex data.
- Any docs or skill text implying Claude Code support is published.
- Any verification claim unsupported by E1.

## Output

Findings first, ordered by severity, with file/line references. Then open questions, residual risk, and recommendation.

