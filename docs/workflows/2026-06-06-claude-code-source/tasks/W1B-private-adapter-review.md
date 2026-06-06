# W1B Private Adapter Review

Mode: `review-session`

## Objective

Review proposed private adapter commit `1a080b1` and Mainline intent
`int_b6b9939a` for correctness and release risk. This is a findings-only review,
not a fix session.

## Required Reads

- `AGENTS.md`
- `docs/ROADMAP.md`
- `docs/workflows/2026-06-06-claude-code-source/README.md`
- `docs/workflows/2026-06-06-claude-code-source/workflow-state.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/R1-remediation.md`
- `mainline show int_b6b9939a --json`
- Diff for `1a080b1` against its base and, where relevant, against current main.

## Review Focus

- Privacy filtering: no tool output, thinking, attachments, diagnostics, sidechain, meta records, or `parentUuid` leakage into searchable projections.
- Source boundary: public CLI must remain Codex-only unless a later promotion slice explicitly changes it.
- Selector, coverage, session identity, FTS, read, and prune safety.
- Raw Claude JSONL stability assumptions.
- Test adequacy, including negative privacy tests and timeout changes.
- Docs/skill/release overclaim risk.

## Allowed Writes

- `docs/workflows/2026-06-06-claude-code-source/handoffs/W1B-private-adapter-review.md`

## Forbidden

- Product code, tests, package files, release config, global tools, installed skills, real transcript fixtures.
- Commit, Mainline append/seal, push, PR, release, install.

## Expected Output

Findings first, ordered by severity, with file/line references where possible.
Then open questions, residual risks, recommendation, proof commands, blockers,
noise_events, efficiency_notes, and tool_fit.
