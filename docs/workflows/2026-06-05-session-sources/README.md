# cxs Session Sources Workflow

## Purpose

Design and implement the multi-source foundation for `cxs` without changing the fixed command surface or publishing a Claude Code adapter in the first phase.

This workflow turns the current Codex-only assumptions into explicit `SessionSource` boundaries, then migrates Codex into the first adapter while preserving existing Codex index, query, read, and coverage behavior.

## Scope

In scope:

- Treat session source as a first-class concept.
- Keep Codex as the default and only public source for the first implementation.
- Design source-aware selector, coverage, and DB compatibility.
- Prepare a reserved boundary for future Claude Code support.
- Keep the command set fixed: `status`, `sync`, `find`, `read-range`, `read-page`, `list`, `stats`.
- Update source checkout docs and `skill-packages/cxs` only when behavior or public guidance changes.

Out of scope:

- Publishing a Claude Code adapter.
- Adding watcher, daemon, realtime sync, MCP server, GUI, or sidecar behavior.
- Changing private dogfood workflows or putting private dogfood guidance into the release skill.
- Pushing, opening PRs, releasing npm packages, updating global skills, or updating the local installed CLI.

## Current Status

- Workflow slug: `2026-06-05-session-sources`
- Canonical control plane: `docs/workflows/2026-06-05-session-sources/`
- Orchestrator branch/worktree: `codex/session-sources-workflow`
- Mainline intent: `int_c1da6c9e`
- Current wave: Wave 0 control-plane setup
- Worker sessions: not launched yet

## Task Map

| Task | Mode | Purpose | Status |
| --- | --- | --- | --- |
| A1 | inventory-packet | Codex single-source assumption inventory | planned |
| A2 | decision-packet | Source/selector/DB identity decision | planned |
| A3 | decision-packet | Claude Code format risk packet | planned |
| D1 | decision-packet | Final architecture design packet | planned |
| I1 | implementation-slice | Codex source adapter and registry | planned |
| I2 | implementation-slice | Source-aware selector, coverage, DB migration | planned |
| I3 | implementation-slice | CLI `--source codex` behavior | planned |
| I4 | implementation-slice | Docs and release skill alignment | planned |
| E1 | evidence-session | Verification evidence | planned |
| R1 | review-session | Final design and implementation review | planned |

## Launch Rule

Start A1, A2, and A3 first. Do not launch D1 until their handoffs are available. Do not launch implementation tasks until D1 is reconciled into this control plane.

