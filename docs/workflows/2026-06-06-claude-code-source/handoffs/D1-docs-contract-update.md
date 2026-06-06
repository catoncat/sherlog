# D1 Docs Contract Update Handoff

task_id: `D1-docs-contract-update`
thread_id: `controller-direct-execution`
cwd: `/Users/envvar/.codex/worktrees/35c5/cxs`
branch: `codex/claude-code-source-C1`
head: `55c0638bcab28ee431b7ca70f145615e07d25f69`
status: `pass`

## Conclusion

D1 passes. Public current-state docs now match the verified C1/V1 checkout
behavior:

- public CLI source remains `codex` only;
- `claude-code` is described as a private / non-public adapter path verified
  with synthetic programmatic smokes;
- docs do not claim public `cxs sync --source claude-code`, npm registry
  release, installed PATH behavior, or global skill state;
- raw Claude JSONL remains a private implementation detail and not a stable
  public format decision.

D1 unlocks S1 skill-source update. It does not unlock lifecycle, release,
install, or global skill update.

## Files Changed

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/INDEX_COVERAGE_DESIGN.md`

## Wording Decisions

- Replaced stale wording that said Claude Code was only a reserved id or had no
  adapter with the current verified state: private / non-public adapter path
  exists in the checkout.
- Kept the public CLI boundary explicit: public source is still only `codex`,
  and `--source claude-code` returns `unsupported_source`.
- Added a public-doc reminder that private Claude Code verification used
  synthetic fixtures, not real transcripts.
- Kept public Claude Code CLI support, raw JSONL public format decision, release
  docs, skill publication, and installed behavior as future gates.

## Release And Install Boundaries

- Source checkout docs changed in `/Users/envvar/.codex/worktrees/35c5/cxs`.
- `skill-packages/cxs/**` was not changed in D1.
- `package.json`, lockfiles, CI, release config, npm registry, installed PATH
  CLI, and global skill state were not changed.
- A globally installed `cxs` may still be the old npm release until the later
  release and install gates pass.

## Mainline Overlap Classification

`mainline preflight --json` in the C1 checkout returned `inspect_or_stop`
because C1 overlaps proposed intent `int_b6b9939a`
(`Implement private Claude Code source adapter`). This is the same earlier
private adapter spike that W1/C1/R2/V1 used as evidence and superseding input.
D1 changed docs only and preserved the same private/public boundary, so this
overlap is not a new semantic conflict for D1.

## Proof Commands

```text
$ pwd && git rev-parse --show-toplevel && git branch --show-current && git rev-parse HEAD && git status --short --untracked-files=all
/Users/envvar/.codex/worktrees/35c5/cxs
/Users/envvar/.codex/worktrees/35c5/cxs
codex/claude-code-source-C1
55c0638bcab28ee431b7ca70f145615e07d25f69
<clean before D1 edits>

$ mainline preflight --json
level=block, allowed_boundary=inspect_or_stop, overlap=int_b6b9939a; classified as same private-adapter spike evidence, non-blocking for docs-only D1.

$ mainline show int_b6b9939a --json
confirmed proposed private adapter spike: public=false, public CLI remains codex-only, no release/install.

$ git diff -- docs README.md AGENTS.md skill-packages/cxs 2>/dev/null || true
showed only README.md and docs/*.md changes; no skill-packages/cxs changes.

$ npm run cxs -- --help
exit 0; command list remains status, sync, find, read-range, read-page, list, stats, help.

$ npm run cxs -- sync --help
exit 0; --source option says session source (public: codex).

$ npm run cxs -- find --help
exit 0; --source option says session source (public: codex).

$ npm run cxs -- status --source claude-code --json
exit 1 by design; error.code unsupported_source; message says only codex is public.

$ git diff --check
exit 0

$ git status --short --untracked-files=all
M README.md
M docs/ARCHITECTURE.md
M docs/INDEX_COVERAGE_DESIGN.md
M docs/ROADMAP.md
?? docs/workflows/2026-06-06-claude-code-source/handoffs/D1-docs-contract-update.md
```

## Missing Or Weak Evidence

- D1 did not update or verify `skill-packages/cxs`; S1 must do that next.
- D1 did not run `npm run check` because it only changed docs and the required
  docs/CLI readbacks passed. V1 already ran `npm run check` against the same C1
  checkout before docs edits.
- D1 did not prove registry, installed CLI, or global skill state.

## Recommendation

Proceed to S1 skill-source update. Keep `claude-code` private/non-public in the
skill source unless a later promotion gate explicitly changes the public CLI
surface.

## Noise Events

- A D1 worktree fork request returned pending id
  `local:28f6aabd-a820-45a6-bcf0-d97004e2ea90`, but no child thread appeared in
  thread search. Controller switched to direct docs-only execution to avoid
  blocking on scheduling.
- The stale V1 fork thread resumed after controller takeover; controller sent a
  second stop message because D1 docs changes were already present in the shared
  C1 checkout.

## Efficiency Notes

- Kept D1 edits to four current-state docs.
- Did not touch skill source, package files, product code, tests, release, or
  installed state.
- Used CLI help/readback only where public docs paraphrase CLI behavior.

## Tool Fit

- `codex-session-orchestrator`: mostly fit; direct controller execution was used
  because the D1 worker fork did not materialize and the slice was docs-only.
- `mainline`: fit; preflight overlap was inspected and classified before edits.
- `superpowers:verification-before-completion`: fit; D1 pass is backed by
  readback and `git diff --check`, not by intent alone.
