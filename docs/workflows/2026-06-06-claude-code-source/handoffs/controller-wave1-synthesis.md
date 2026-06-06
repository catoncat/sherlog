# Controller Wave 1 Synthesis

status: reconciled
controller_thread_id: `019e9b54-7344-7a51-86a8-db3d2e3db02b`
source_handoffs:
- `handoffs/W1A-truth-reconciliation.md`
- `handoffs/W1B-private-adapter-review.md`

## Conclusion

Do not promote, merge, release, or install candidate `1a080b1` as-is.

Treat `1a080b1` as a private spike with useful implementation material. Git
replay onto latest main is straightforward, but review found source integrity
and metadata/privacy issues that must be fixed before the private adapter can be
considered a safe source-aware slice.

## Reconciled Evidence

W1A established:

- Latest main `b82d052e8af9d0460cf73f82e587d84b969500b9` and candidate
  `1a080b1abf8e75dd9ecba607af4dca7c7141b3fb` are sibling commits from
  merge-base `24a8f46aedc8268ac6e34c7952693c869ad1a890`.
- There is no exact file overlap and no predicted text merge conflict.
- Candidate is not on latest main and is only a proposed private adapter intent,
  not released public behavior.
- Replaying must preserve current-main parser/snippet/format fixes, especially
  Codex parser summary truncation.

W1B established:

- P1: Claude source snapshot accepts mismatched explicit selector source; a
  programmatic Claude sync can scan Claude files while downstream coverage,
  count, and prune behave as Codex.
- P1: Claude parser captures `sessionId` and `cwd` before skipping `isMeta` /
  `isSidechain`, so skipped records can influence session identity and metadata
  projections even when not searchable text.
- P1: Claude inventory accepts early `cwd` / `timestamp` from any record, so
  meta/sidechain/diagnostic records can influence inventory grouping, selector
  filtering, fingerprints, coverage freshness, and scoped sync.
- P2: public CLI boundary remains intact; `--source claude-code` is still
  rejected and no docs/skill release surface was changed by the candidate.
- P2: raw Claude JSONL support remains a stability risk and must stay private
  until a future SDK/session API or raw-format decision packet.
- P2: negative tests miss selector mismatch and metadata-ordering cases; timeout
  bumps need re-evaluation under latest main.

## Decision

Next implementation, when orchestration is resumed, should be a narrow private
rework slice from latest main, not a public promotion:

1. Start from current main `b82d052`.
2. Replay or reimplement only the private adapter material needed from
   `1a080b1`.
3. Enforce source/selector matching before Claude inventory/snapshot/sync can
   proceed.
4. Move Claude parser metadata capture behind the same skip/allowlist policy as
   message text, or document a separate trusted metadata exception before using
   it.
5. Make Claude inventory metadata extraction source-policy aware; skipped
   meta/sidechain/diagnostic records must not choose `cwd`, timestamps,
   fingerprints, or coverage behavior by accident.
6. Preserve current-main parser truncation and snippet/format performance fixes.
7. Add negative tests for selector-source mismatch, meta/sidechain-first
   `sessionId`, `cwd`, and `timestamp` sentinels, plus public CLI rejection.
8. Keep `claude-code` private/non-public and avoid docs/skill release claims.

## Current Boundary

The current user correction pauses orchestration expansion:

- Do not launch new workers yet.
- Do not commit, seal, push, release, install, or update global skills.
- Do not use replacement W1B evidence unless original W1B is later found invalid.

## Next Action When Resumed

Prepare a single implementation-slice prompt for `C1-private-adapter-rework`.
The worker should own product code changes in an isolated worktree and must not
promote Claude Code publicly. Required proof should include focused unit tests,
`npm run check`, CLI `--source claude-code` rejection smoke, and a private
programmatic sync/read smoke using synthetic fixtures only.
