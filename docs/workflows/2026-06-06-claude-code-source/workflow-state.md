# Workflow State

## Snapshot

- Updated: 2026-06-06
- Status: PR #51 merged; `v0.3.5` released to npm; PATH CLI and global skill updated
- Controller thread: `019e9b54-7344-7a51-86a8-db3d2e3db02b`
- Controller worktree: `/Users/envvar/.codex/worktrees/4b9e/cxs`
- Controller branch: `codex/claude-code-source-controller`
- Mainline intent: `int_c0ac32dc`
- Current main HEAD: `bcc43dd9f1e6caf0774dbb45867294db56ad38ad`
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

Controller reconciliation after C1:

- C1 committed local implementation `55c0638` on branch
  `codex/claude-code-source-C1`.
- C1 handoff was copied into the canonical controller control plane at
  `handoffs/C1-private-adapter-rework.md`.
- `C1-acceptance-checklist.md` is all pass based on the worker handoff, local
  commit readback, and controller diff review.
- No public docs, public skill source, package metadata, release, install, push,
  or PR action occurred.
- Next gate is R2 post-rework review. V1 verification may run only after R2
  does not find unresolved P1 blockers.

Controller reconciliation after R2:

- R2 review thread `019e9c46-2e32-7683-bb63-5c1b30d35c35` completed in
  worktree `/Users/envvar/.codex/worktrees/3004/cxs`.
- R2 handoff was copied into the canonical controller control plane at
  `handoffs/R2-post-rework-review.md`.
- R2 found no unresolved P1 and recommended proceeding to V1 verification.
- No product code, tests, package metadata, public docs, public skill source,
  release, install, push, PR, or global skill update occurred.
- Next gate is V1 verification. Public docs/skill/release/install work remains
  gated until V1 proof is reconciled.

Active V1 launch:

- Task and starter prompt prepared at `tasks/V1-verification.md` and
  `prompts/V1-verification.md`.
- Expected implementation checkout is C1 branch `codex/claude-code-source-C1`
  at commit `55c0638`.
- V1 thread `019e9c5b-2e38-72f3-9439-2762d5cbe64f` was forked from the C1
  worker into `/Users/envvar/.codex/worktrees/35c5/cxs` and sent the V1
  evidence-only prompt.
- V1 is evidence-only: no product edits, public docs/skill edits, commit, seal,
  push, PR, release, install, or global skill update.

Controller reconciliation after V1:

- The forked V1 worker thread
  `019e9c5b-2e38-72f3-9439-2762d5cbe64f` produced no visible handoff or C1
  worktree writes after repeated controller polls; controller sent a stop
  message and took over V1 serially.
- V1 verification ran against C1 checkout
  `/Users/envvar/.codex/worktrees/35c5/cxs` at commit `55c0638`.
- `npm run check`, public CLI help/status/rejection smokes, Codex synthetic
  smoke, private Claude synthetic smoke, timeout grep, `git diff --check`, and
  final C1 status all passed.
- V1 handoff was written to `handoffs/V1-verification.md`.
- Next gate is D1 public docs and contract update. S1, lifecycle, release,
  installed CLI, and global skill state remain gated.

Controller reconciliation after D1:

- Task and starter prompt prepared at `tasks/D1-docs-contract-update.md` and
  `prompts/D1-docs-contract-update.md`.
- D1 ran against C1 implementation checkout
  `/Users/envvar/.codex/worktrees/35c5/cxs` at commit `55c0638`.
- D1 updated only current-state docs (`README.md`, `docs/ARCHITECTURE.md`,
  `docs/ROADMAP.md`, `docs/INDEX_COVERAGE_DESIGN.md`) and wrote
  `handoffs/D1-docs-contract-update.md`.
- D1 public wording keeps `codex` as the only public CLI source and describes
  `claude-code` only as a private/non-public synthetic-verification path.
- D1 proof included CLI help/readback, unsupported-source smoke, and
  `git diff --check`.
- D1 did not touch `skill-packages/sherlog`, product code/tests, package metadata,
  release/install/global skill, push, PR, commit, or seal.
- Next gate is S1 skill-source update. Lifecycle, release, installed CLI, and
  global skill state remain gated.

Active S1 launch:

- Task and starter prompt prepared at `tasks/S1-skill-source-update.md` and
  `prompts/S1-skill-source-update.md`.
- S1 must run against a checkout containing C1 commit `55c0638` plus D1 docs
  changes.
- S1 is skill-source only: no product code/tests, package metadata,
  release/install/global skill, push, PR, commit, or seal.
- S1 fork requested from C1 thread `019e9c11-bf21-7921-8128-9123ef439c61` with
  pending worktree id `local:de428e65-8a27-430e-a46d-53db11089100`.
- S1 child resolved as thread `019e9c7a-42f5-7022-854f-c635286dfd09` in
  worktree `/Users/envvar/.codex/worktrees/c2b0/cxs`.
- S1 prompt has been sent. The worker must update only `skill-packages/sherlog/**`
  and `handoffs/S1-skill-source-update.md`.

Controller reconciliation after S1:

- S1 thread `019e9c7a-42f5-7022-854f-c635286dfd09` ran in worktree
  `/Users/envvar/.codex/worktrees/c2b0/cxs`.
- S1 handoff was copied into the canonical controller control plane at
  `handoffs/S1-skill-source-update.md`.
- S1 updated only `skill-packages/sherlog/**` and its handoff in the worker
  checkout, keeping the distributable skill source Codex-only for public CLI
  use while describing `claude-code` as a private/non-public checkout adapter
  path for synthetic verification and future promotion.
- S1 proof included `git diff -- skill-packages/sherlog`,
  `npx skills ls -g --json`, `git diff --check`, `npm run shlog -- --help`,
  `npm run shlog -- status --help`, and the expected
  `npm run shlog -- status --source claude-code --json` unsupported-source
  smoke.
- S1 did not commit, seal, push, PR, release, install, npm publish, update
  package metadata, or update global skill state.
- Next gate is L1 lifecycle integration: combine C1 implementation, D1 docs,
  and S1 skill-source changes into a scoped verified commit and Mainline seal.
  P1 release and I1 installed smoke remain gated.

L1 lifecycle integration:

- Controller integrated C1 implementation, D1 docs, S1 skill source, and
  controller handoffs into branch `codex/claude-code-source-controller`.
- L1 verification before commit included `npm run check` passing 28 test files /
  178 tests, CLI help/readback, public `claude-code` status and selector
  rejection smokes returning `unsupported_source`, `npx skills ls -g --json`,
  `git diff --check`, and focused source tests.
- A parallel focused subset run of `src/cli.test.ts` once hit the existing 5s
  per-test timeout; the exact timed-out test passed when run alone in 2.62s,
  and the full `npm run check` passed.
- Local L1 commit `feat(sources): 集成 Claude 私有适配器` was created.
- Mainline seal submit for `int_c0ac32dc` succeeded with code commit
  `169d3434e179e30ddc2c8c2de25a7c39e9febf75`; no conflicts were returned.
- `mainline lint int_c0ac32dc --json` passed.
- No push, PR, release, npm publish, installed CLI update, or global skill
  update occurred during L1.

P1 release closeout:

- Started Mainline intent `int_c9461f18` for `准备 Sherlog 0.3.5 release PR`.
- Registry readback before release: `npm view @act0r/sherlog version --json`
  returned `0.3.4`.
- `package.json` and `package-lock.json` were bumped to `0.3.5` with
  `npm version 0.3.5 --no-git-tag-version`; no tag was created.
- Release-prep verification passed: `npm run check` (28 test files / 178
  tests), `npm run build`, and `npm pack --dry-run`.
- `npm pack --dry-run` reported package `@act0r/sherlog@0.3.5`, tarball
  `act0r-cxs-0.3.5.tgz`, and contents `LICENSE`, `README.md`, `dist/cli.js`,
  and `package.json`.
- Local commit `chore(release): bump 0.3.5` was created.
- Mainline seal submit for `int_c9461f18` succeeded with code commit
  `209b2e85c2be8139888af9d509150b28b199ab27`; it returned a medium-confidence
  overlap with `int_c0ac32dc` because release-prep stacks on the sealed source
  integration files. This is a workflow dependency, not a contradictory
  implementation plan.
- `mainline lint int_c9461f18 --json` passed.
- Branch `codex/claude-code-source-controller` was pushed to origin.
- Draft PR #51 was opened against `main`:
  `https://github.com/catoncat/sherlog/pull/51`.
- PR #51 readback via
  `gh pr view 51 --repo catoncat/sherlog --json number,title,url,isDraft,state,mergeStateStatus,headRefName,baseRefName,reviewDecision,statusCheckRollup,latestReviews,commits`:
  `state=OPEN`, `isDraft=true`, `mergeStateStatus=CLEAN`,
  `headRefName=codex/claude-code-source-controller`, `baseRefName=main`,
  `reviewDecision=""`, and `latestReviews=[]`.
- PR #51 CI readback via `statusCheckRollup`: workflow `ci`, job `test`,
  `status=COMPLETED`, `conclusion=SUCCESS`, details URL
  `https://github.com/catoncat/sherlog/actions/runs/27061046513/job/79873841382`.
- Branch run readback via
  `gh run list --repo catoncat/sherlog --branch codex/claude-code-source-controller --limit 10 --json databaseId,workflowName,displayTitle,status,conclusion,createdAt,updatedAt,headSha,event,url`:
  run `27061046513`, workflow `ci`, event `pull_request`, head SHA
  `209b2e85c2be8139888af9d509150b28b199ab27`, status `completed`,
  conclusion `success`, URL `https://github.com/catoncat/sherlog/actions/runs/27061046513`.
- PR #51 was marked ready, latest review-fix head `f64ffc3` passed workflow
  `ci` run `27062651358` and Cubic re-review.
- PR #51 merged into `main` at `2026-06-06T13:18:30Z` with squash commit
  `bcc43dd9f1e6caf0774dbb45867294db56ad38ad`.
- Release tag `v0.3.5` was pushed on top of `bcc43dd`; GitHub Actions release
  workflow run `27063398021` completed successfully and job
  `publish npm package` published to npm.
- Registry readback after publish: `npm view @act0r/sherlog version --json`
  returned `"0.3.5"`.
- PATH install was updated from the published registry package with
  `pnpm add -g @act0r/sherlog@0.3.5`.
- Installed smoke after a local native rebuild fix:
  `command -v shlog` -> `/Users/envvar/Library/pnpm/bin/cxs`;
  `which -a shlog` -> `/Users/envvar/Library/pnpm/bin/cxs`,
  `/Users/envvar/Library/pnpm/cxs`;
  `shlog --version` -> `0.3.5`;
  `shlog status --json` passed;
  `shlog list --cwd /Users/envvar/.codex/worktrees/4b9e/cxs --limit 3 --json`
  passed.
- Global skill was updated from published GitHub source with
  `npx skills add catoncat/sherlog --full-depth --skill sherlog -g -a codex -y`;
  `npx skills ls -g --json` readback shows `Sherlog` at
  `/Users/envvar/.agents/skills/cxs`.

Current correction after user clarification:

- Do not launch new replacement workers.
- Normal C1 implementation worker is allowed and has been launched.
- C1 may commit locally after its required verification passes; push, PR,
  release, install, and global skill update remain gated.
- Original W1B thread `019e9b58-31fd-7b00-9c7d-c6085e9cf25c` is the primary review worker and has produced the canonical W1B handoff.
- Ignore W1B replacement thread `019e9b5e-765c-7ab1-91c2-cdb5341f8f76`; it was cancelled and its evidence is not used.

## Stop Lines

- This workflow no longer has an internal stop line for pending milestones; all
  planned gates through release/install closeout have passed.
- Do not treat this file as authorization for a new public-promotion or
  adapter-expansion slice. Start a new workflow for subsequent work.

- Stop for missing credentials/auth, unavailable external systems, destructive data loss risk, secret exposure risk, or unresolvable semantic conflict.
- Stop before indexing real Claude transcript content into committed fixtures or durable artifacts.
- Merge/release/install gate has passed for `0.3.5`; future changes must gather
  fresh release/install proof again.

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
- 2026-06-06: C1 committed local implementation `55c0638` and produced
  `handoffs/C1-private-adapter-rework.md`; controller copied the handoff,
  reviewed the C1 diff/readback, and marked C1 reconciled in the checklist.
- 2026-06-06: R2 review thread
  `019e9c46-2e32-7683-bb63-5c1b30d35c35` completed with no unresolved P1;
  controller copied `handoffs/R2-post-rework-review.md` into the canonical
  control plane and marked V1 as next.
- 2026-06-06: Prepared `tasks/V1-verification.md` and
  `prompts/V1-verification.md` to run evidence-only verification on the C1
  implementation checkout.
- 2026-06-06: Forked C1 thread into V1 thread
  `019e9c5b-2e38-72f3-9439-2762d5cbe64f` and sent the evidence-only V1 prompt.
- 2026-06-06: V1 worker did not produce handoff or worktree writes after
  repeated polling; controller sent a stop message, ran V1 serially on C1
  checkout `55c0638`, wrote `handoffs/V1-verification.md`, and marked D1 as
  next.
- 2026-06-06: Prepared `tasks/D1-docs-contract-update.md` and
  `prompts/D1-docs-contract-update.md` for docs/contract-only update after V1.
- 2026-06-06: Reconciled D1 docs/contract update from C1 checkout; copied
  `handoffs/D1-docs-contract-update.md` into the canonical control plane,
  marked S1 as next, and prepared `tasks/S1-skill-source-update.md` plus
  `prompts/S1-skill-source-update.md`.
- 2026-06-06: Requested S1 fork from C1 thread with pending worktree id
  `local:de428e65-8a27-430e-a46d-53db11089100`; no child thread id was visible
  on the first thread-list poll.
- 2026-06-06: Resolved S1 as thread
  `019e9c7a-42f5-7022-854f-c635286dfd09` in worktree
  `/Users/envvar/.codex/worktrees/c2b0/cxs`; sent the S1 skill-source-only
  prompt.
- 2026-06-06: Reconciled S1 skill-source handoff into the canonical control
  plane and marked L1 lifecycle integration as next; no lifecycle, release,
  install, or global skill action was performed.
- 2026-06-06: Integrated C1 implementation, D1 docs, S1 skill source, and
  controller handoffs; verified the combined checkout and created local commit
  `feat(sources): 集成 Claude 私有适配器`. Mainline seal/lint remains next.
- 2026-06-06: Submitted Mainline seal for `int_c0ac32dc`; lint passed. Started
  release-prep intent `int_c9461f18`, bumped package metadata to `0.3.5`, ran
  `npm run check`, `npm run build`, and `npm pack --dry-run`, then created local
  release-prep commit `chore(release): bump 0.3.5`. Push/PR/release/install are
  still pending.
- 2026-06-06: Sealed and linted release-prep intent `int_c9461f18`, pushed
  branch `codex/claude-code-source-controller`, opened draft PR #51, and read
  back CI `test` success plus old registry/PATH version `0.3.4`. Release and
  install gates remain pending.
- 2026-06-06: Rechecked live PR/CI/install truth for PR #51: PR remains
  `OPEN` and draft, `mergeStateStatus=CLEAN`, no reviews are present, CI run
  `27061046513` succeeded, npm registry remains `0.3.4`, and PATH `Sherlog`
  remains `/Users/envvar/Library/pnpm/bin/cxs` at `0.3.4`.
