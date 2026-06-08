# Sherlog Multi-Source Foundation Design

## Problem Statement

`Sherlog` is currently a Codex session retrieval CLI. The command surface is fixed, but the implementation still assumes one transcript source in root resolution, JSONL inventory, parsing, selector identity, coverage keys, DB uniqueness, query/read paths, and public wording.

The multi-source foundation should make session source explicit while preserving today's Codex behavior. The first implementation publishes only `codex`. Claude Code is reserved as a future adapter boundary, not a public feature in this workflow.

The hard decisions represented here come from:

- A1: Codex-only assumptions are concentrated in `src/env.ts`, `src/source-inventory.ts`, `src/parser.ts`, `src/selector.ts`, `src/db/**`, `src/query/**`, `src/status.ts`, `src/indexer.ts`, `src/cli.ts`, docs, and `skill-packages/sherlog`.
- A2: `source_id` must be a DB, selector, coverage, query, and read dimension. Missing public source input defaults to `codex`. Bare `session_uuid` remains Codex-compatible input/output but must not remain global internal identity.
- A3: Reserve `claude-code`, but keep raw Claude JSONL shape private/deferred. Future Claude decoding belongs in an adapter, preferably SDK-reader first for public behavior.

## Source Adapter Interface And Ownership

Introduce a small source registry around a `SessionSourceAdapter` interface. The core owns canonical parsed sessions, DB persistence, selector/coverage logic, query/read/list/stats behavior, and CLI option wiring. Each adapter owns source-specific roots, inventory metadata, raw transcript decoding, and adapter-private filtering.

Conceptual interface:

```ts
export type SessionSourceId = "codex" | "claude-code";

export interface SessionSourceAdapter {
  id: SessionSourceId;
  public: boolean;
  displayName: string;
  defaultRoot(): string;
  resolveRoot(override?: string): string;
  collectInventory(root: string): Promise<SourceInventory>;
  collectSnapshot(selector: SourceSelector): Promise<SourceSnapshot>;
  parseFile(file: SourceFileMeta): Promise<ParseSessionResult>;
}
```

The first implementation should register only the public `codex` adapter for normal CLI use. The registry may know the reserved `claude-code` id as a non-public source for type boundaries and future tests, but CLI help and public docs must not advertise Claude support until an implementation wave explicitly promotes it.

Canonical parsed output should become source-neutral:

- `sourceId`: adapter id.
- `nativeSessionId`: the adapter's native session identifier.
- `sessionKey`: internal source-qualified key, for example `codex:<nativeSessionId>`.
- `filePath`, `sourceRoot`, `title`, `summaryText`, `compactText`, `reasoningSummaryText`, `cwd`, `model`, `startedAt`, `endedAt`, `messages`.
- Message roles remain canonical `user | assistant` in phase one.
- `sourceKind` remains adapter-owned provenance, not a cross-source contract.

## Codex Migration Path

Codex becomes the first adapter by wrapping current behavior:

- `DEFAULT_CODEX_DIR` and `resolveCodexDir()` become Codex adapter defaults.
- Current `.jsonl` walking, path-date extraction, cwd prefix scan, and fingerprint logic move behind the Codex inventory/snapshot methods.
- `parseCodexSession()` remains Codex-specific and returns canonical parsed sessions with `sourceId = "codex"`, `nativeSessionId = current sessionUuid`, and `sessionKey = "codex:" + sessionUuid`.
- Current event support remains unchanged: `session_meta`, `turn_context`, `event_msg`, `compacted`, and `response_item.reasoning` are Codex adapter details.
- Public result fields should keep `sessionUuid` as today's Codex UUID for compatibility. Internally, query/read/delete/replace should use `session_id` or `sessionKey`.

Codex must remain the default source when the user omits `--source` or `selector.source`.

## Selector And Coverage Source Model

Selectors become source-aware without changing selector kinds:

```ts
type SourceSelector =
  | { source: "codex"; kind: "all"; root: string }
  | { source: "codex"; kind: "date_range"; root: string; fromDate: string; toDate: string }
  | { source: "codex"; kind: "cwd"; root: string; cwd: string }
  | { source: "codex"; kind: "cwd_date_range"; root: string; cwd: string; fromDate: string; toDate: string };
```

Rules:

- Input selector JSON may omit `source`; canonical selectors always contain `source: "codex"` in phase one.
- CLI `--source` supplies the selector default source. If both `--source` and selector JSON `source` are present, they must match.
- `selectorImplies()` must return false across different sources.
- `selectorContainsFile()` and SQL predicates must filter by `source_id` as well as root/cwd/date.
- Coverage records store `source_id` separately and canonical selector JSON includes `source`.
- Coverage uniqueness must be source-aware. Either `selector_key` includes canonical source or the DB uses `UNIQUE(source_id, selector_key)`; storing both makes debugging clearer.
- Fresh `all(root)` coverage only covers narrower selectors inside the same source.

`root` remains source-local. The same path string under two sources is not equivalent unless the source is also equal.

## DB Migration And Old Data Strategy

Bump `INDEX_VERSION`, for example to `cxs-v7-source-identity`. The migration should preserve existing Codex data and make stale coverage rebuild through normal sync.

Recommended schema direction:

- Add `sessions.source_id TEXT NOT NULL DEFAULT 'codex'`.
- Add `sessions.native_session_id TEXT NOT NULL DEFAULT ''`.
- Add `sessions.session_key TEXT NOT NULL DEFAULT ''`.
- Backfill old rows with `source_id = 'codex'`, `native_session_id = session_uuid`, and `session_key = 'codex:' || session_uuid`.
- Replace global uniqueness with source-aware identity:
  - unique internal `session_key`, or `UNIQUE(source_id, native_session_id)`.
  - `UNIQUE(source_id, file_path)` for replacement by raw file.
- Keep `session_uuid` during compatibility phases as the Codex-facing field. Do not use it as the only relation key.
- Prefer `sessions.id` plus `messages.session_id` and `UNIQUE(session_id, seq)` for message identity.
- Rebuild or migrate FTS tables so they join by `rowid/session_id` and cannot dedupe colliding native ids across sources.
- Add `coverage.source_id TEXT NOT NULL DEFAULT 'codex'`.
- Backfill coverage selectors by canonicalizing missing `source` to `codex`.
- Prune/delete/replace must always be scoped by source and selector. A sync for one source must not remove another source's sessions.

Old Codex reads should continue to work:

- `read-range <uuid>` and `read-page <uuid>` resolve as Codex when no source qualifier or `--source` is provided.
- Future source-qualified input can use `<source>:<nativeId>` without adding commands.
- If a future non-Codex source creates ambiguity for a bare id, the CLI should ask for `--source` or a qualified id instead of guessing.

## CLI Behavior, Especially `--source`

Add `--source <id>` to the fixed commands where source affects scope:

- `status`
- `sync`
- `find`
- `list`
- `read-range`
- `read-page`
- `stats`

Phase-one accepted value: `codex`. Unknown or non-public values, including `claude-code`, return `unsupported_source` with a message that only Codex is public in this release.

Compatibility rules:

- Omitting `--source` means `codex`.
- Existing `--root`, `--selector`, and `--cwd` behavior remains Codex-compatible.
- Selector JSON with missing `source` canonicalizes to Codex.
- `--source` and selector JSON `source` must match.
- `--root` is interpreted by the selected source adapter.
- JSON output may include `source` / `sourceId` in new fields after the implementation wave decides exact contract shape, but existing Codex fields must remain present.

## Command Behavior

### `status`

`status` reports context for the selected source. With no `--source`, it reports Codex exactly as today except source metadata may appear in JSON. `status --selector` canonicalizes missing selector source to Codex and reports coverage/freshness only for matching source. It remains read-only and must not sync.

### `sync`

`sync` resolves the selected adapter, collects its snapshot, parses files through that adapter, writes source-aware sessions/messages/FTS rows, and writes source-aware coverage. `--prune` only removes sessions in the selected source and selected scope. `--best-effort` keeps the existing rule that coverage is not written when partial errors occur.

### `find`

`find` searches indexed data for the selected source by default. Selector filters include source. Deduplication keys must include source-qualified identity, not bare `sessionUuid`. `--exclude-session` remains accepted for Codex UUIDs in phase one; future behavior should accept source-qualified ids.

### `list`

`list` lists sessions for the selected source. `--cwd`, `--since`, sort, limit, and selector behavior remain unchanged except source is part of the predicate and zero-result nextAction points to source-aware sync.

### `read-range`

`read-range <sessionUuid>` resolves a session in the selected source. Bare ids default to Codex for compatibility. Internally it should resolve to one session row or source-qualified key before anchor search and range reads. Coverage entries returned with the session must be source-matching only.

### `read-page`

`read-page <sessionUuid>` follows the same source resolution as `read-range`. It must not page across a colliding native id from another source.

### `stats`

`stats` reports counts for the selected source by default. In phase one this is Codex. Future cross-source totals can be added only with an explicit design, not as accidental aggregation.

## Claude Code Reserved Boundary And Non-Public Status

Claude Code support is reserved, not shipped.

Allowed now:

- Reserve source id `claude-code`.
- Keep source registry and selector/coverage/DB dimensions capable of representing it.
- Keep parser ownership boundaries so a future adapter can decode Claude records without changing core query logic.

Not public in this workflow:

- No `shlog sync --source claude-code`.
- No help text claiming Claude support.
- No docs or skill guidance telling users to rely on Claude transcripts.
- No indexing of Claude tool results, attachments, diagnostics, snapshots, hook payloads, signatures, thinking, or sidechain data.

Future Claude adapter guidance:

- Prefer official SDK/session APIs for public behavior.
- Use raw JSONL only for adapter tests, audit evidence, or an explicitly experimental path.
- Allowlist user/assistant text only.
- Skip `isMeta === true`.
- Exclude `isSidechain === true` until subagent semantics are designed.
- Treat title, timestamp, and parent relationships as optional metadata.
- Skip unknown or malformed records outside strict mode.

## Test Strategy

Implementation waves should add focused tests before broad dogfood gates:

- Selector canonicalization defaults missing `source` to `codex`.
- Selector parser rejects mismatch between CLI `--source` and selector JSON `source`.
- `selectorImplies()` is false across sources.
- Coverage records and freshness are source-aware.
- Old DB rows backfill as Codex.
- Same native session id can exist under two sources without message/FTS/read collisions.
- Bare `read-range <uuid>` and `read-page <uuid>` still resolve Codex.
- Source-qualified read resolves the intended source row.
- `sync --prune` for one source cannot delete another source.
- `find` dedupe and `--exclude-session` do not collapse colliding native ids.
- `status`, `sync`, `find`, `list`, `read-range`, `read-page`, and `stats` accept omitted source as Codex.
- `--source claude-code` returns unsupported/non-public until a future workflow promotes it.
- Existing Codex CLI smoke still works through `npm run shlog -- ...`.

Docs-only D1 proof is `git diff --check`.

## Phased Implementation Plan

### I1: Codex Adapter And Registry

Create the source id type, adapter interface, registry, and Codex adapter. Move default root, inventory/snapshot, and parser ownership behind Codex without changing behavior. Keep public CLI default as Codex.

### I2: Source-Aware Storage, Selector, And Coverage

Add source fields, migration/backfill, source-aware uniqueness, source-aware selector canonicalization/implication, source-aware SQL predicates, FTS/read/delete/replace safety, and an index version bump.

### I3: CLI `--source codex`

Wire `--source` through all fixed commands. Preserve omitted-source behavior. Reject unknown and non-public sources. Add focused CLI tests and JSON error shape tests.

### I4: Docs And Release Skill Alignment

Update current checkout docs and `skill-packages/sherlog` only after implementation behavior exists. State that Codex is the only public source and Claude Code is reserved/non-public.

### E1: Evidence

Run `npm run check`, targeted source-aware tests, and Codex smoke commands using `npm run shlog -- ...`. Record source checkout state separately from npm release, global skill, and installed CLI state.

### R1: Review

Review design conformance, source boundary enforcement, compatibility with old Codex data, and whether any public docs imply Claude support prematurely.

## Risks And Deferred Questions

- Migration complexity: SQLite uniqueness changes may require table rebuilds rather than simple `ALTER TABLE`.
- FTS identity: source-qualified identity must be proven in both message and session recall paths.
- JSON contract shape: exact new output fields for `source`, `sourceId`, `nativeSessionId`, and `sessionKey` should be finalized in I2/I3 tests before public docs change.
- Read identity UX: future ambiguous bare ids need a stable error contract.
- `stats` aggregation: phase one should stay selected-source scoped; cross-source aggregate stats are deferred.
- Claude ingestion route: future public Claude support should choose SDK-reader first unless there is fresh evidence that raw JSONL is stable enough.
- Claude privacy: tool results, attachments, diagnostics, snapshots, hook payloads, thinking, and sidechain messages must stay out of default indexing until separately designed.
- Source naming: `codex` and reserved `claude-code` are accepted for this design. Do not introduce aliases without a public contract decision.
