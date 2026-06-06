# V1 Verification Handoff

task_id: `V1-verification`
thread_id: `controller-takeover-after-019e9c5b-2e38-72f3-9439-2762d5cbe64f`
cwd: `/Users/envvar/.codex/worktrees/35c5/cxs`
branch: `codex/claude-code-source-C1`
head: `55c0638bcab28ee431b7ca70f145615e07d25f69`
reviewed_commit: `55c0638bcab28ee431b7ca70f145615e07d25f69`
status: `pass`

## Conclusion

V1 passes for current checkout behavior at C1 commit `55c0638`. This unlocks D1
public docs and contract update work.

V1 does not prove release, installed CLI, or global skill state. It does not
promote `claude-code` as a public CLI source.

## Requirement To Proof Matrix

| Requirement | Result | Proof |
| --- | --- | --- |
| C1 checkout is the verified target | pass | `pwd` and `git rev-parse --show-toplevel` returned `/Users/envvar/.codex/worktrees/35c5/cxs`; branch `codex/claude-code-source-C1`; HEAD `55c0638bcab28ee431b7ca70f145615e07d25f69`; initial status clean. |
| Full check passes | pass | `npm run check` exit 0; `tsc --noEmit && vitest run`; 28 test files and 178 tests passed. |
| CLI command surface remains fixed | pass | `npm run cxs -- --help` lists only `status`, `sync`, `find`, `read-range`, `read-page`, `list`, `stats`, and `help`; no new public command was added. |
| Default status works with the checkout CLI | pass | `npm run cxs -- status --json` exit 0; opened `/Users/envvar/.local/state/cxs/index.sqlite` and reported `indexVersion: "cxs-v7-source-identity"`. |
| Public `claude-code` source remains rejected | pass | `npm run cxs -- status --source claude-code --json` exit 1 by design with `error.code: "unsupported_source"` and message saying only `codex` is public. |
| Public selector `source: "claude-code"` remains rejected | pass | `npm run cxs -- sync --selector '{"source":"claude-code",...}' --json` exit 1 by design with `error.code: "unsupported_source"`. |
| Codex default smoke works on synthetic data | pass | Synthetic Codex JSONL under a temp root synced with `added=1`, `errors=0`, `coverageWritten=true`, `indexedSessionCount=1`; `find` returned the synthetic session; `read-page` returned `sourceId: "codex"` and both synthetic messages. |
| Private Claude synthetic path works and stays isolated | pass | Programmatic private `syncSessions({ sourceId: "claude-code" })` on synthetic JSONL synced with `added=1`, `errors=0`; `findSessions(..., { sourceId: "claude-code" })` found `claude-code:accepted-v1-session`; default Codex find returned zero results; read page returned only accepted messages. |
| Skipped Claude sentinels do not leak | pass | Private smoke checked meta/sidechain/tool/thinking/attachment/session/cwd/timestamp sentinels and returned `leaked=false`. |
| Timeout changes remain absent | pass | `rg -n "testTimeout|setConfig|timeout"` found only existing DB/lock timeout code/comments and no C1 test timeout increase. |
| Final diff/status clean for C1 checkout | pass | `git diff --check` exit 0; final `git status --short --untracked-files=all` produced no output in `/Users/envvar/.codex/worktrees/35c5/cxs`. |

## Command Results

```text
$ pwd
/Users/envvar/.codex/worktrees/35c5/cxs

$ git rev-parse --show-toplevel
/Users/envvar/.codex/worktrees/35c5/cxs

$ git branch --show-current
codex/claude-code-source-C1

$ git rev-parse HEAD
55c0638bcab28ee431b7ca70f145615e07d25f69

$ git status --short --untracked-files=all
<clean>

$ npm run check
exit 0; tsc --noEmit and Vitest passed; 28 test files passed, 178 tests passed.

$ npm run cxs -- --help
exit 0; command list is status, sync, find, read-range, read-page, list, stats, help.

$ npm run cxs -- status --json
exit 0; context cwd /Users/envvar/.codex/worktrees/35c5/cxs; root /Users/envvar/.codex/sessions; dbPath /Users/envvar/.local/state/cxs/index.sqlite; indexVersion cxs-v7-source-identity.

$ npm run cxs -- status --source claude-code --json
exit 1 by design; error.code unsupported_source; message says only codex is public.

$ npm run cxs -- sync --selector '{"source":"claude-code","kind":"all","root":"<tmp>"}' --db <tmp>/index.sqlite --json
exit 1 by design; error.code unsupported_source; message says only codex is public.

$ npm run cxs -- sync/find/read-page with a synthetic Codex temp root
exit 0; sync added=1 errors=0 coverageWritten=true indexedSessionCount=1; find returned aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa; read-page sourceId=codex with expected synthetic messages.

$ node --import tsx <private synthetic Claude smoke>
exit 0; sync added=1 errors=0 coverageWritten=true indexedSessionCount=1; private find returned claude-code:accepted-v1-session; default Codex find returned 0; read-page returned sourceId=claude-code and accepted messages; leaked=false.

$ rg -n "testTimeout|setConfig|timeout" src package.json $(rg --files -g 'vitest.config.*' -g 'vite.config.*') 2>/dev/null || true
exit 0; only existing DB/lock timeout code/comments were found.

$ git diff --check
exit 0

$ git status --short --untracked-files=all
<clean>
```

## Smoke Details

### Codex Default Synthetic Smoke

- Generated one synthetic Codex JSONL under a temp `/tmp` sessions root.
- Used public checkout CLI:
  - `npm run --silent cxs -- sync --root <tmp>/sessions --db <tmp>/index.sqlite --json`
  - `npm run --silent cxs -- find "v1 codex synthetic needle" --root <tmp>/sessions --db <tmp>/index.sqlite --json`
  - `npm run --silent cxs -- read-page aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa --db <tmp>/index.sqlite --json`
- Decisive output: `added=1`, `errors=0`, first find session
  `aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa`, read messages
  `["v1 codex synthetic needle", "v1 codex synthetic answer"]`.

### Private Claude Synthetic Smoke

- Generated one synthetic Claude JSONL under a temp `/tmp` projects root.
- Used programmatic private adapter path, not public CLI promotion.
- Accepted synthetic records indexed and read:
  - first private find session: `claude-code:accepted-v1-session`
  - read messages: `["v1 private claude needle", "v1 private claude answer"]`
  - read session `sourceId: "claude-code"`, `nativeSessionId:
    "accepted-v1-session"`, `cwd: "/tmp/accepted-v1-cwd"`
- Default Codex find against the same DB returned zero results for the private
  Claude needle.
- Skipped sentinel check returned `leaked=false` for meta, sidechain, tool
  result, thinking, attachment, skipped session IDs, skipped cwd, and skipped
  1999 timestamps.

## Missing Or Weak Evidence

- V1 did not verify npm registry, installed PATH CLI, or global skill state.
- V1 did not promote or verify a public `claude-code` CLI path.
- V1 did not resolve the future public format decision for raw Claude JSONL
  versus a more stable SDK/session API.

## Recommendation

Unlock D1 public docs and contract update. Keep `claude-code` private in public
wording unless a later promotion gate explicitly changes the public surface.

Do not proceed to S1, lifecycle, release, install, or global skill update until
their own gates produce direct evidence.

## Noise Events

- A forked V1 worker thread `019e9c5b-2e38-72f3-9439-2762d5cbe64f` remained
  active without visible handoff or C1 worktree writes after repeated
  controller polls. The controller sent a stop message and took over V1
  serially to avoid duplicate evidence writes.
- `npm run cxs -- status --json` produced a very large source inventory for the
  real local Codex sessions root; only the decisive context/index fields were
  needed for this handoff.
- An initial timeout grep with a zsh glob produced `no matches found`; the
  final grep used `rg --files` and completed successfully.

## Efficiency Notes

- Used C1's already installed dependencies and clean checkout.
- Used temp synthetic fixtures for Codex and Claude; no repo fixture files were
  created.
- Avoided rerunning worker-level focused test subsets separately because
  `npm run check` covered them and V1 added end-to-end synthetic smokes.

## Tool Fit

- `codex-session-orchestrator`: fit; V1 was kept evidence-only and did not
  edit product code.
- `mainline`: fit as ambient workflow context; no Mainline lifecycle mutation
  was performed.
- `superpowers:verification-before-completion`: fit; V1 completion is based on
  fresh command evidence, not C1/R2 assertions alone.
