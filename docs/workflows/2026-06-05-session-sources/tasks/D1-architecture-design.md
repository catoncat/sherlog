# D1: Architecture Design Packet

Mode: `decision-packet`

## Objective

Synthesize A1, A2, and A3 into a current-state-aligned design for the cxs multi-source foundation.

## Read Paths

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/A1-codex-assumption-inventory.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/A2-source-selector-db-decision.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/A3-claude-format-risk.md`
- Current code paths cited by the handoffs.

## Allowed Writes

- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/D1-architecture-design.md`

## Forbidden

- No source implementation.
- No schema edits.
- No docs outside this workflow directory.
- No skill package edits.
- No push, PR, release, global skill install, or local CLI install.

## Required Design Sections

- Problem statement.
- Source adapter interface and ownership.
- Codex migration path.
- Selector and coverage source model.
- DB migration and old data strategy.
- CLI behavior, especially `--source`.
- `status`, `sync`, `find`, `list`, `read-range`, `read-page`, `stats` behavior.
- Claude Code reserved boundary and explicit non-public status.
- Test strategy.
- Phased implementation plan.
- Risks and deferred questions.

## Proof

- Show that all A1/A2/A3 hard decisions are represented.
- Run `git diff --check`.

## Escalation

Stop if A1/A2/A3 disagree on an identity model; return a decision request instead of choosing silently.
