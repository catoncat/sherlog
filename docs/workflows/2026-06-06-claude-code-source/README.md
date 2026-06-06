# cxs Claude Code Source Workflow

## Purpose

Continue the source-aware `cxs` roadmap after the Codex source foundation has
landed on main. This workflow decides whether and how the proposed private
Claude Code adapter commit `1a080b1` should move forward, without treating it as
released public behavior.

## Objective

Evolve `cxs` from Codex-only local session search into a reliable source-aware
local session retrieval engine. Preserve existing Codex behavior. Promote
Claude Code support only after adapter strategy, privacy filtering, tests, docs,
skill source, release, and installed smoke all pass.

## Canonical Inputs

- Current main: `b82d052e8af9d0460cf73f82e587d84b969500b9`
- Proposed private adapter commit: `1a080b1abf8e75dd9ecba607af4dca7c7141b3fb`
- Proposed Mainline intent: `int_b6b9939a`
- Completed foundation workflow: `docs/workflows/2026-06-05-session-sources/`
- R1 remediation: `docs/workflows/2026-06-05-session-sources/handoffs/R1-remediation.md`

## Boundaries

- Controller owns planning, session registry, handoff reconciliation, and lifecycle gates.
- Implementation, review, verification, docs, release, and install work belong to bounded worker sessions.
- Controller may edit only this workflow control plane unless explicitly switching roles.
- Public CLI remains Codex-only until a later verified promotion slice changes that.
- Do not use real Claude transcript content as committed fixtures.
- Do not create or promote private dogfood goldens without explicit `$cxs-dogfood`.
- Keep the fixed command set: `status`, `sync`, `find`, `read-range`, `read-page`, `list`, `stats`.
- Keep release/install layers separate: source checkout, skill source, npm registry CLI, local PATH CLI.

Detailed active controller rules are in `operating-rules.md`.

## Current Shape

Wave 1 was read-only truth reconciliation plus independent review:

- `W1A`: reconcile latest main, `int_b6b9939a`, and commit `1a080b1`.
- `W1B`: review the private Claude adapter candidate for privacy, source boundary, test, and docs/release risks.

The controller has synthesized both handoffs and prepared the next private
implementation slice without launching it under the current pause.

The remaining lifecycle is tracked in `milestone-plan.md`. Concrete proof
contracts are in `verification-runbook.md`; C1 handoff reconciliation uses
`C1-acceptance-checklist.md`. Do not advance to docs, skill, release, or
installed-smoke work until the preceding milestone gates pass.

If this controller rolls over, resume from `handoffs/controller-checkpoint.md`.
Use `completion-audit.md` before any claim that the full Goal is complete.
