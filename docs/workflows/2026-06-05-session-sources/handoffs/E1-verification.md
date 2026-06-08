# E1 Handoff: Verification Evidence

Thread: `019e974b-751b-7030-8cd3-d0b9b7455971`
Status: completed with boundary findings
Mode: `evidence-session`

## Conclusion

The source checkout at `f8c7b2cf453627a3177d7614d0277455837190a4` passes the full repository check after local verification dependencies are materialized with `npm ci`. Checkout CLI behavior proves Codex remains the public/default source, `--source codex` works on a fresh source-aware index, and `--source claude-code` is rejected as non-public.

Do not inflate this to release/install completion. The npm registry and installed PATH CLI still report version `0.3.4`, but the installed `Sherlog` on PATH rejects `--source`, and the global `Sherlog` skill is a symlink to `/Users/envvar/work/repos/cxs/skill-packages/sherlog`, not the current reconciled checkout source.

## Files Read

- `docs/workflows/2026-06-05-session-sources/README.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/milestone-plan.md`
- `docs/workflows/2026-06-05-session-sources/wave-map.md`
- `docs/workflows/2026-06-05-session-sources/tasks/E1-verification.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/D1-architecture-design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I1-codex-adapter.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I2-source-aware-storage.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I3-cli-source-option.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I4-docs-skill-alignment.md`
- `src/parser.test.ts`
- `src/cli.test.ts`

## Files Changed

- `docs/workflows/2026-06-05-session-sources/handoffs/E1-verification.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/E1-artifacts/codex-root/2026/06/05/rollout-2026-06-05T10-00-00-e1e10000-e1e1-41e1-81e1-e1e1e1e1e1e1.jsonl`
- `docs/workflows/2026-06-05-session-sources/handoffs/E1-artifacts/e1-smoke.sqlite`

SQLite sidecar files `e1-smoke.sqlite-shm` and `e1-smoke.sqlite-wal` were also produced by the smoke run.

## Requirement-To-Proof Matrix

| Requirement | Evidence | Strength |
| --- | --- | --- |
| E1 starts only after I4 complete and E1 ready | `wave-map.md` says Wave 3 I1/I2/I3/I4 complete and E1 ready | strong |
| Full checkout verification | `npm run check` exit 0 after `npm ci`; TypeScript passed; Vitest 27 files / 152 tests passed | strong |
| Omitted source defaults to Codex | `npm run shlog -- status --json` exit 0; root `/Users/envvar/.codex/sessions`, indexVersion constant `cxs-v7-source-identity`, 784 source files, 3532 sessions, 179298 messages | strong for status |
| `--source codex` status works | `npm run shlog -- status --source codex --json` exit 0 with same Codex root and counts as omitted source | strong |
| `sync` writes source-aware coverage | Artifact command `sync --source codex --root ... --db ... --json` exit 0; `scanned=1`, `added=1`, selector and coverage include `source: "codex"`, indexVersion `cxs-v7-source-identity` | strong on fresh db |
| Focused `find --source codex` works | Artifact command `find "e1 source codex smoke needle" --source codex --db ... --json` exit 0; one result, expected session UUID/title/snippet | strong on fresh db |
| Focused `list --source codex` works | Artifact command `list --source codex --db ... --limit 1 --json` exit 0; `query.sourceId="codex"`, one expected result | strong on fresh db |
| Read paths preserve Codex source identity | Supplemental `read-page --source codex` and `read-range --source codex --seq 0` exit 0; session includes `sourceId`, `nativeSessionId`, and `sessionKey=codex:<uuid>` | strong on fresh db |
| `stats --source codex` scopes to Codex | Supplemental `stats --source codex --db ... --json` exit 0; `sessionCount=1`, `messageCount=2`, coverage selector has `source: "codex"` | strong on fresh db |
| Non-public `claude-code` rejected | `npm run shlog -- status --source claude-code --json` exit 1 by design; JSON error `code=unsupported_source`, `source=claude-code`, message says only Codex is public | strong |
| Public docs/skill source aligned in checkout | `rg` over checkout docs and `skill-packages/sherlog` finds `--source codex`, `claude-code` reserved/non-public, only Codex public wording | strong for source checkout |
| Published / installed layers updated | Registry/install readbacks show they are not updated to this behavior | missing by design |

## Command Results

- Initial identity before workflow reads:
  - `pwd` -> `/Users/envvar/.codex/worktrees/d0f2/cxs`
  - repo root -> `/Users/envvar/.codex/worktrees/d0f2/cxs`
  - branch -> detached HEAD
  - commit -> `f8c7b2cf453627a3177d7614d0277455837190a4`
  - initial `git status --short` -> clean
- `npm ci` -> exit 0; installed ignored local verification dependencies; no tracked package files changed.
- `npm run check`:
  - first run before dependency setup -> exit 127, `tsc: command not found`
  - final run after `npm ci` -> exit 0; TypeScript passed; Vitest 27 files / 152 tests passed.
- `npm run shlog -- status --json`:
  - first run before dependency setup -> exit 127, `tsx: command not found`
  - final run -> exit 0; Codex source inventory root `/Users/envvar/.codex/sessions`, totalFiles 784, index sessionCount 3532, messageCount 179298, coverage `[]`.
- `npm run shlog -- status --source codex --json` -> exit 0; same Codex root/counts as omitted source.
- `npm run shlog -- status --source claude-code --json` -> exit 1 expected; JSON `unsupported_source`.
- `npm run shlog -- list --source codex --limit 1 --json` against the default local db -> exit 1, `SqliteError: no such column: source_id`; this is a default-index compatibility boundary, not the fresh checkout smoke result.
- Artifact fresh-db smoke:
  - `sync --source codex --root docs/.../E1-artifacts/codex-root --db docs/.../e1-smoke.sqlite --json` -> exit 0; `added=1`, `errors=0`, source-aware coverage written.
  - first parallel `find/list` attempt -> exit 1 `index_unavailable` because it raced before sync completed.
  - rerun `find "e1 source codex smoke needle" --source codex --db docs/.../e1-smoke.sqlite --json` -> exit 0; one expected result.
  - rerun `list --source codex --db docs/.../e1-smoke.sqlite --limit 1 --json` -> exit 0; one expected result.
  - `read-page --source codex --db docs/.../e1-smoke.sqlite --json` -> exit 0; source-qualified session fields present.
  - first `read-range` supplemental attempt -> exit 1 due missing required `--seq` or `--query`.
  - rerun `read-range --source codex --seq 0 --db docs/.../e1-smoke.sqlite --json` -> exit 0; source-qualified session fields present.
  - `stats --source codex --db docs/.../e1-smoke.sqlite --json` -> exit 0; one session, two messages.
- `git status --short --untracked-files=all` before handoff -> only allowed E1 artifact files were untracked.

## Release/Install Boundary Matrix

| Layer | Readback | Conclusion |
| --- | --- | --- |
| Source checkout | `git rev-parse HEAD` -> `f8c7b2cf453627a3177d7614d0277455837190a4`; detached HEAD; only E1 handoff/artifacts untracked after verification | current reconciled checkout verified |
| Source docs and skill source | `git log -1 -- README.md docs/ARCHITECTURE.md docs/ROADMAP.md skill-packages/sherlog` -> `22b0d95 docs(Sherlog): 对齐 source 文档和 skill`; checkout `rg` finds public Codex / reserved Claude wording | checkout source aligned |
| npm registry CLI | `npm view @act0r/sherlog version` -> `0.3.4` | registry version read, but version alone does not prove source behavior; no publish done |
| Installed PATH CLI | `command -v shlog` -> `/Users/envvar/Library/pnpm/bin/cxs`; `which -a shlog` -> pnpm shim paths; `shlog --version` -> `0.3.4`; `shlog status --source codex --json` -> exit 1 `unknown option '--source'` | installed CLI is old behavior and does not include this checkout's source option |
| Installed global skill | `npx --no-install skills ls -g --json` exit 0 and lists `Sherlog` at `/Users/envvar/.agents/skills/cxs`; `ls -la` shows symlink to `/Users/envvar/work/repos/cxs/skill-packages/sherlog`; that repo is clean at `251f9bf68e90d8fe5a547331ce40efaf2a074671`; `rg` finds no source/Claude wording there | global skill is not updated to the reconciled checkout source and is symlinked to the main repo |

## Missing Or Weak Evidence

- The default local Sherlog index at `/Users/envvar/.local/state/cxs/index.sqlite` is not safe evidence for source-aware read/list behavior: `list --source codex` fails with `no such column: source_id`. `status` has a read-only fallback and succeeds, but broader default-index runtime claims are weak until the default index is synced/migrated through an allowed workflow.
- E1 did not test a real second public source because `claude-code` must remain non-public. Cross-source collision/isolation is covered by `npm run check` and prior I2/I3 handoffs, not by a live second-source adapter.
- Release/install evidence is intentionally negative: no npm publish, local CLI install, or global skill install was performed.

## Blockers Or Decisions Needed

- Decide whether a later workflow should run an allowed local `shlog sync` or migration path for the default index. Current checkout source works on a fresh source-aware db, but default read commands can hit old-schema DB state.
- Decide how to handle the installed global `Sherlog` skill symlink. It currently points to the main repo checkout, not a GitHub-installed release skill snapshot.
- Decide release sequencing if public users need `--source codex`: registry version is still `0.3.4`, and installed PATH CLI with the same version lacks the option.

## Noise Events

- Before orchestrator clarification, `npm run check` and checkout CLI commands failed due missing local `node_modules`; after allowed `npm ci`, they passed or produced meaningful runtime results.
- Borrowing `/Users/envvar/work/repos/cxs/node_modules` via `PATH`/`NODE_PATH` did not work for checkout ESM dependency resolution; abandoned once `npm ci` was allowed.
- I incorrectly parallelized artifact `sync` with `find/list`; `find/list` raced and reported `index_unavailable`. Serial reruns passed.
- I ran `read-range` once without required anchor options; rerun with `--seq 0` passed.
- One `rg` global skill scan treated a pattern beginning with `--source` as a flag, then a second attempt put `-g` after `--`; final corrected source/global scans were recorded.

## Efficiency Notes

- `npm ci` took about 1 second; final `npm run check` took about 9 seconds.
- Parallel reads were useful for workflow context and boundary readbacks.
- The artifact db kept smoke evidence isolated from the user's default index and exposed the default-index schema boundary without mutating it.
- Token overhead came mainly from large JSON `status` and `skills ls` outputs; summaries above retain only decision-making fields.

## Tool Fit

- `codex-session-orchestrator` fit the delegated Goal, evidence-session boundary, and handoff structure.
- Shell commands fit verification and readback. No source fix, docs fix outside handoff, Mainline append/seal, commit, push, PR, release, global skill install, or local CLI install was performed.
- `apply_patch` fit the allowed fixture and handoff writes. No browser or GitHub tooling was needed.
