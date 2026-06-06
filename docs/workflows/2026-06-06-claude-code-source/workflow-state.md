# Workflow State

## Snapshot

- Updated: 2026-06-06
- Status: Wave 1 launching
- Controller thread: `019e9b54-7344-7a51-86a8-db3d2e3db02b`
- Controller worktree: `/Users/envvar/.codex/worktrees/4b9e/cxs`
- Controller branch: `codex/claude-code-source-controller`
- Mainline intent: `int_c0ac32dc`
- Current main HEAD: `b82d052e8af9d0460cf73f82e587d84b969500b9`
- Private adapter candidate: `1a080b1abf8e75dd9ecba607af4dca7c7141b3fb`
- Private adapter intent: `int_b6b9939a`

## First Readback

- Repo root: `/Users/envvar/.codex/worktrees/4b9e/cxs`
- Initial branch state: detached `HEAD`; controller branch created after clean readback.
- Initial HEAD: `b82d052e8af9d0460cf73f82e587d84b969500b9`
- Initial `git status --short`: clean
- `mainline status --json`: initialized; local/main head both `b82d052`; worktree clean; 10 proposed intents; 5 uncovered commits on main; agent authority `proposed_intent`; guidance update available.

## Decisions

- Use a new workflow control plane for Claude Code public-readiness work instead of reopening the completed `2026-06-05-session-sources` workflow.
- Treat `1a080b1` as a proposed private adapter candidate and evidence source, not as public or released behavior.
- Do not launch implementation until Wave 1 reconciliation and review handoffs are available.
- Continue autonomously between waves; do not pause for user approval unless a true blocker appears.

## Active Wave

Wave 1: read-only reconciliation and review.

Required controller synthesis after Wave 1:

- Whether `1a080b1` can be rebased/cherry-picked onto latest main.
- Whether the candidate should remain private, be split, be reworked, or be abandoned.
- Whether public Claude support should use raw JSONL, SDK/session API, or a staged hybrid.
- Which implementation, docs, verification, release, and install workers to launch next.

## Stop Lines

- Stop for missing credentials/auth, unavailable external systems, destructive data loss risk, secret exposure risk, or unresolvable semantic conflict.
- Stop before indexing real Claude transcript content into committed fixtures or durable artifacts.
- Do not merge/release/install unless the relevant worker proof and release gates pass.

## State Log

- 2026-06-06: Created controller Goal.
- 2026-06-06: Read handoff, AGENTS, roadmap, prior workflow control plane, R1 remediation, Mainline current context, and `int_b6b9939a`.
- 2026-06-06: Created controller branch `codex/claude-code-source-controller` from main HEAD.
- 2026-06-06: Started Mainline intent `int_c0ac32dc`.
- 2026-06-06: Committed control-plane baseline as `783e17a`.
- 2026-06-06: Requested W1A and W1B worker sessions; launcher returned pending worktree ids.
- 2026-06-06: Resolved W1B thread `019e9b58-31fd-7b00-9c7d-c6085e9cf25c` in `/Users/envvar/.codex/worktrees/eaa1/cxs`; it launched from `783e17a`, which has task files but not the later pending-registry update.
- 2026-06-06: Original W1A pending thread did not appear in thread search; launched replacement W1A with pending id `local:486ec5a5-236c-4984-9749-1df16d8aaccf`.
- 2026-06-06: Resolved replacement W1A thread `019e9b59-30ed-7862-b092-90c487543e73` in `/Users/envvar/.codex/worktrees/2034/cxs`.
- 2026-06-06: Original W1A thread `019e9b57-e526-77c3-9499-540c926668e0` appeared after replacement launch; controller sent a stop/superseded message to avoid duplicate handoff writes.
- 2026-06-06: W1A handoff landed in worker worktree with recommendation to replay private adapter onto latest main and rework parser truncation consistency.
- 2026-06-06: Original W1B thread `019e9b58-31fd-7b00-9c7d-c6085e9cf25c` did not produce handoff after checkpoint; launched narrow replacement W1B pending `local:b9b0df9b-a5fd-4439-9248-2b31de51b6ba`.
