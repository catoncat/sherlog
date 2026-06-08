# I3: CLI Source Option Behavior

Mode: `implementation-slice`

## Objective

Add the public CLI source option behavior chosen by D1 while keeping the fixed command set and Codex default behavior.

## Read Paths

- D1 design packet.
- `src/cli.ts`
- `src/status.ts`
- `src/indexer.ts`
- `src/query/**`
- `src/format.ts`
- `src/types.ts`
- related CLI/status/query tests.

## Allowed Writes

Expected bounded paths, subject to D1:

- `src/cli.ts`
- `src/status.ts`
- `src/indexer.ts`
- `src/query/**` only where CLI source filters are required
- `src/format.ts` only for source display/error output
- `src/types.ts`
- related tests
- `docs/workflows/2026-06-05-session-sources/handoffs/I3-cli-source-option.md`

## Forbidden

- Do not add new commands.
- Do not publish or document Claude Code as available.
- Do not update release skill or user docs; I4 owns that.
- No push, PR, release, global skill install, or local CLI install.

## Proof

- CLI tests for default Codex behavior and explicit `--source codex`.
- Unsupported source error test if unsupported values are accepted by parser.
- `npm run check`.
- Smoke with `npm run shlog -- status --source codex --json` if D1 chooses that command shape.
- `git diff --check`.

## Commit And Seal

Use an isolated worktree. Start or confirm a Mainline intent for I3. Commit and seal only the verified I3 slice.

## Escalation

Stop if adding `--source` requires changing positional arguments or command names.
