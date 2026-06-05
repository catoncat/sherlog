# Milestone Plan

## Wave 0: Control Plane

Goal: create durable workflow artifacts and task prompts.

Proof:

- All minimum control-plane files exist.
- Every task has a task file and prompt file.
- `git diff --check` passes.
- Mainline intent exists for the control-plane slice.

Exit gate:

- Control plane committed and sealed, or blocker documented.

## Wave 1: Read-Only Packets

Tasks:

- A1 Codex single-source assumption inventory.
- A2 source/selector/DB identity decision.
- A3 Claude Code transcript risk boundary.

Proof:

- Each worker has a Goal.
- Each worker returns a compact handoff.
- Orchestrator reconciles handoffs into `handoffs/`.

Exit gate:

- D1 can be written without guessing.

## Wave 2: Design Packet

Task:

- D1 architecture design packet.

Proof:

- Design states source adapter interface, DB/selector migration strategy, CLI behavior, docs/skill boundary, tests, rollout phases, and non-goals.
- Design explicitly lists unresolved or deferred Claude Code behavior.

Exit gate:

- User or orchestrator approves implementation wave.

## Wave 3: Implementation Slices

Tasks:

- I1 Codex source adapter and registry.
- I2 source-aware selector, coverage, and DB migration.
- I3 CLI `--source codex`.
- I4 docs and skill alignment.

Proof:

- Each slice has focused tests or explicit docs verification.
- Each slice commits scoped changes.
- Mainline seal succeeds or blocker is documented.

Exit gate:

- Implementation is ready for evidence session.

## Wave 4: Evidence And Review

Tasks:

- E1 verification.
- R1 review.

Proof:

- `npm run check` result recorded.
- Required CLI smoke results recorded.
- Review findings are either fixed, deferred, or accepted as non-blocking.

Exit gate:

- Registry current.
- Handoffs complete.
- No active heartbeat remains.
- Final status distinguishes source checkout, release skill, npm CLI release, and local installed CLI state.
