# Operating Rules

## Authority

Follow, in order:

1. User instructions in the active thread.
2. Repository `AGENTS.md` and Mainline rules.
3. This workflow control plane.
4. Task file assigned to the worker session.

If this file conflicts with the task file, the narrower task file wins for that worker.

## Source Of Truth

- Current code and tests are authoritative for implemented behavior.
- Official Claude Code documentation and inspected local samples are evidence for future Claude support, not a commitment to publish support now.
- `skill-packages/sherlog` is release skill source only; do not treat local global skill state as published state.
- Installed `Sherlog` on PATH represents npm registry release behavior, not checkout behavior.

## Write Boundaries

Orchestrator writes:

- `docs/workflows/2026-06-05-session-sources/**`

Worker writes depend on each task file. Workers must stop before touching:

- Root config or dependencies.
- DB migration or schema outside an implementation task that explicitly owns it.
- `skill-packages/sherlog` outside I4.
- `data/sherlog-dogfood/**` or private dogfood goldens.
- Global skills under `~/.agents/skills` or `~/.claude/skills`.
- npm release files, tags, GitHub PRs, or production state.

## Mainline

- This workflow uses Mainline.
- Read-only workers do not append, seal, commit, or push.
- Implementation workers start or confirm their own task intent, commit verified slices, and seal when ready for handoff.
- Stop before push, PR, merge, release, npm publish, global skill install, or local CLI install.

## Evidence Rules

No worker may claim completion without evidence. Acceptable proof:

- File/line inventory with current code paths.
- Focused tests for changed behavior.
- `git diff --check` for docs-only control-plane changes.
- `npm run check` for implementation changes.
- CLI smoke using `npm run shlog -- ...` for checkout behavior.
- Explicit note when a proof is intentionally deferred.

## Stop Lines

Stop and report before:

- Expanding Claude Code adapter beyond reserved/experimental design.
- Changing public JSON contracts without D1 decision.
- Changing `session_uuid` semantics without A2/D1 evidence.
- Deleting existing indexed data or changing prune semantics.
- Updating global installed skill or local installed CLI.
- Launching implementation tasks before A1/A2/A3/D1 are reconciled.

## Handoff Format

Every worker returns or writes:

- conclusion
- files read
- files changed
- proof commands and results
- blockers or decisions needed
- next recommended step
- noise_events
- efficiency_notes
- tool_fit
