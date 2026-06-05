# I4 Handoff: Docs And Release Skill Alignment

Thread: `019e973e-d6c5-7862-bbc4-178b92506b3d`
Status: verified; commit and Mainline seal run after this handoff is written.
Mode: `implementation-slice`
Mainline intent: `int_be172a7e`

## Conclusion

Aligned current-state docs and release `cxs` skill source with the implemented source foundation. Public wording now says `codex` is the only public source, omitted `--source` means Codex, and `claude-code` is reserved/non-public. No Claude Code adapter, global skill update, npm release, installed CLI update, push, or PR was performed.

## Actual Workspace

- cwd: `/Users/envvar/.codex/worktrees/0bdd/cxs`
- repo root: `/Users/envvar/.codex/worktrees/0bdd/cxs`
- initial branch: detached `HEAD`
- working branch: `codex/session-sources-i4`
- starting commit: `df365653322bfe283a08a3c39dc91305a5969f2b`
- initial `git status --short`: clean

## Files Read

- `docs/workflows/2026-06-05-session-sources/wave-map.md`
- `docs/workflows/2026-06-05-session-sources/design.md`
- `docs/workflows/2026-06-05-session-sources/operating-rules.md`
- `docs/workflows/2026-06-05-session-sources/tasks/I4-docs-skill-alignment.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/D1-architecture-design.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I1-codex-adapter.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I2-source-aware-storage.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I3-cli-source-option.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `README.md`
- `skill-packages/cxs/SKILL.md`
- `skill-packages/cxs/references/cli-surface.md`
- `skill-packages/cxs/references/json-schema.md`
- `skill-packages/cxs/references/progressive-workflow.md`
- `skill-packages/cxs/references/failure-cookbook.md`
- `skill-packages/cxs/references/advanced-queries.md`
- `src/types.ts`

## Files Changed

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `skill-packages/cxs/SKILL.md`
- `skill-packages/cxs/references/advanced-queries.md`
- `skill-packages/cxs/references/cli-surface.md`
- `skill-packages/cxs/references/failure-cookbook.md`
- `skill-packages/cxs/references/json-schema.md`
- `skill-packages/cxs/references/progressive-workflow.md`
- `docs/workflows/2026-06-05-session-sources/handoffs/I4-docs-skill-alignment.md`

## Proof Commands And Results

- `git diff --check`
  - exit 0.
- `npm run cxs -- --help`
  - exit 0; fixed command list remains `status`, `sync`, `find`, `read-range`, `read-page`, `list`, `stats`.
- `npm run cxs -- status --help`
  - exit 0; help shows `--source <id>      session source (public: codex)`.
- `npm run cxs -- status --source claude-code --json`
  - exit 1 by design; JSON error code `unsupported_source`, source `claude-code`, message says only `codex` is public in this release.
- `npm run check`
  - exit 0; TypeScript passed; Vitest 27 files / 152 tests passed.

## Release And Install Boundaries

- Source layer: this checkout now documents source-aware selector/coverage/DB/read behavior and public `--source codex`.
- Skill source layer: `skill-packages/cxs` source is updated in this checkout only.
- CLI release layer: no npm publish, tag, release workflow, or registry verification was performed.
- Installed local layer: no global `cxs`, PATH shim, or installed global skill was modified. Installed release behavior may lag this checkout until a future release/install workflow runs.

## Commit And Mainline Seal Status

- Commit status at handoff write time: pending; intended commit message `docs(cxs): 对齐 source 文档和 skill`.
- Mainline seal status at handoff write time: pending; intent `int_be172a7e`.
- Preflight/overlap classification: same-workflow D1/I1/I2/I3/control-plane overlaps are expected stacked workflow context, not a semantic conflict. Existing Mainline uncovered commits, old proposals, notes rewrite drift, and AGENTS update notices were left untouched.

## Blockers

None for I4.

## E1 Contract

- E1 should treat this as checkout/source documentation only.
- E1 should separately record: source checkout state, release skill source state, npm CLI release state, and installed local CLI/skill state.
- E1 should not infer global `cxs` or installed skill behavior from this checkout.
- E1 should keep `claude-code` reserved/non-public unless a later workflow explicitly implements and publishes it.

## Noise Events

- First `npm run cxs -- --help` failed because `node_modules` was absent (`tsx: command not found`); fixed with local `npm ci`.
- I initially started Mainline intent `int_48d5fcf3` while still on detached `HEAD`; after creating `codex/session-sources-i4`, I started `int_be172a7e` and abandoned the detached draft.
- `rg ... tests ...` reported missing `tests` directory; useful source/doc hits were still collected.
- Mainline reported unrelated uncovered commits, old proposals, possible notes rewrite drift, AGENTS update availability, and a sibling workflow draft; none changed I4 scope.

## Efficiency Notes

- Parallel reads helped gather workflow handoffs, docs, skill references, Mainline context, and CLI help quickly.
- `npm ci` took about 1 second; `npm run check` took about 6 seconds after dependencies were installed.
- Running full `npm run check` was not strictly required for docs-only edits, but cheap enough and useful because `json-schema.md` mirrors code contracts.

## Tool Fit

- `codex-session-orchestrator` fit the delegated Goal/handoff workflow.
- Mainline fit branch intent setup and overlap classification, though starting before branch creation caused one avoidable abandoned draft.
- Shell, `rg`, `sed`, and `apply_patch` fit the bounded docs/skill update.
