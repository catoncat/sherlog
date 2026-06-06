# Workflow State

## Snapshot

- Updated: 2026-06-06
- Status: C1 launching
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
- Pause orchestration expansion after W1A/W1B reconciliation under the current user boundary.

## Active Wave

Wave 1: read-only reconciliation and review.

Controller synthesis after Wave 1:

- `1a080b1` can be replayed onto latest main from a Git-conflict standpoint.
- The candidate must remain private and must be reworked before any merge or
  public promotion.
- Raw Claude JSONL remains a private experimental route; public ingestion still
  needs a future SDK/session API or raw-format decision packet.
- Next worker, when orchestration resumes, should be a narrow
  `C1-private-adapter-rework` implementation slice from latest main.
- The C1 task contract and starter prompt are prepared but not launched.
- `milestone-plan.md` now tracks the full remaining lifecycle from C1 through
  review, verification, docs, skill source, commit/Mainline, release, and
  installed smoke.
- `operating-rules.md` records active pause semantics, evidence rules, and
  launch rules.
- `handoffs/controller-checkpoint.md` is the current rollover/recovery handoff.
- `completion-audit.md` tracks full-goal requirements and currently shows the
  goal is incomplete.
- `verification-runbook.md` defines proof contracts for C1, R2, V1, D1, S1,
  L1, P1, I1, and final completion.
- `C1-acceptance-checklist.md` defines the controller reconciliation checklist
  for the future C1 handoff.
- `templates/C1-handoff-template.md` defines the expected C1 handoff shape.

Active C1 launch:

- Branch: `codex/claude-code-source-C1`
- Thread: `019e9c11-bf21-7921-8128-9123ef439c61`
- Worktree: `/Users/envvar/.codex/worktrees/35c5/cxs`
- Pending worktree id resolved from: `local:65ba3b0c-539f-4085-9581-4cc10522cbba`
- Worker role: normal implementation worker, not replacement.
- Boundary: C1 may implement and verify private adapter rework; no push, PR,
  release, install, or global skill update.

Current correction after user clarification:

- Do not launch new replacement workers.
- Normal C1 implementation worker is allowed and has been launched.
- C1 may commit locally after its required verification passes; push, PR,
  release, install, and global skill update remain gated.
- Original W1B thread `019e9b58-31fd-7b00-9c7d-c6085e9cf25c` is the primary review worker and has produced the canonical W1B handoff.
- Ignore W1B replacement thread `019e9b5e-765c-7ab1-91c2-cdb5341f8f76`; it was cancelled and its evidence is not used.

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
- 2026-06-06: Process correction: original W1B thread `019e9b58-31fd-7b00-9c7d-c6085e9cf25c` was still active and had surfaced valid risk findings, so it remains the main review worker.
- 2026-06-06: W1B replacement thread `019e9b5e-765c-7ab1-91c2-cdb5341f8f76` was a premature replacement launch; mark as noise and ignore unless original W1B fails or cannot write handoff.
- 2026-06-06: Confirmed replacement W1B cancellation final; it reported `cancelled_by_controller=true` and no evidence should be used unless primary W1B fails.
- 2026-06-06: Original W1B wrote `handoffs/W1B-private-adapter-review.md`; controller copied that handoff into canonical control plane for reconciliation.
- 2026-06-06: Controller reconciled W1A/W1B into `handoffs/controller-wave1-synthesis.md`; next worker is identified but not launched due current user boundary.
- 2026-06-06: Prepared `tasks/C1-private-adapter-rework.md` and `prompts/C1-private-adapter-rework.md` as launch-ready control-plane artifacts only; C1 remains not launched under the current pause.
- 2026-06-06: Added `milestone-plan.md` to preserve release/install layer
  gates while orchestration expansion remains paused.
- 2026-06-06: Added `operating-rules.md` and
  `handoffs/controller-checkpoint.md`; controller remains paused before C1 and
  no workers or lifecycle actions were started.
- 2026-06-06: Added `completion-audit.md` to prevent premature full-goal
  completion claims; no product or lifecycle actions were started.
- 2026-06-06: Added `verification-runbook.md` with gate-specific proof
  contracts; no worker or lifecycle action was started.
- 2026-06-06: Added `C1-acceptance-checklist.md` and linked it from the C1
  task/prompt; no worker or lifecycle action was started.
- 2026-06-06: Added `templates/C1-handoff-template.md` and linked it from the
  C1 task/prompt; no worker or lifecycle action was started.
- 2026-06-06: Reconciled `handoffs/controller-checkpoint.md` after later
  control-plane files were added; no worker or lifecycle action was started.
- 2026-06-06: Corrected earlier pause misread and resumed normal orchestration;
  created branch `codex/claude-code-source-C1` at `bfdefa8` and launched C1
  pending worktree `local:65ba3b0c-539f-4085-9581-4cc10522cbba`.
- 2026-06-06: Resolved C1 as thread
  `019e9c11-bf21-7921-8128-9123ef439c61` in worktree
  `/Users/envvar/.codex/worktrees/35c5/cxs`.
