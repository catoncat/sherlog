# Source Adapter Contracts

This document defines the searchable projection contract for the native Rust source adapters. It is not a promise that upstream transcript formats are stable. `claude-code`, `pi`, and `dsh` remain experimental transcript readers.

## Public seam

`src/sources/mod.rs` exposes one narrow seam:

- `SourceCatalog::scan(selector, cache)` performs one traversal plus cache-aware inventory projection and returns accepted files, inventory, snapshot, and per-file scan failures. A cache miss may stream raw records/body; an exact metadata/checkpoint hit avoids re-parsing.
- projection converts one byte-bounded `SourceFile` into a privacy-reviewed `SessionProjection`, accepted message documents, `ReadProof`, and an opaque checkpoint.
- source-specific JSON keys, allowlists, reducer state, and raw-format drift remain private adapter implementation.

The registry is static: `codex`, `claude-code`, `pi`, `dsh`. Adding a runtime plugin is not part of this contract.

## Shared invariants

### Privacy projection

- Only allowlisted session metadata, user/assistant text, and explicitly accepted session-profile fields enter SQLite.
- Tool calls/results, attachments, diagnostics, thinking, sidechain/meta records, and unsupported content parts are rejected by default.
- Accepted message text becomes `documents.kind = "message"`; profile fields become one `session_profile` document during index write.
- Rejected/private records must not enter `documents`, `documents_fts`, snippets, summaries, inventory cwd grouping, or accepted metadata fingerprint.
- Status uses the same privacy decision for inventory proof: only accepted projection may influence cwd/time/session identity/fingerprint. It does not return or search body text, but a cache miss can still read raw bytes; exact `mtime_ns`/checkpoint cache hits avoid that parse.
- Broaden an allowlist only with source-specific positive and negative privacy fixtures.

### Identity and read isolation

- Every accepted session has `sourceId`, `nativeSessionId`, `sessionKey = sourceId:nativeSessionId`, and a compatibility `sessionUuid`.
- `find` returns a source-aware `sessionRef`; `read-*` consumes it without guessing the source.
- Same native id across sources cannot collide.

### Bounded JSONL read

- Content projection reads no bytes beyond the captured limit.
- Only fully newline-terminated records advance the append-safe cursor.
- Malformed/non-object JSONL records are skipped as format noise; an unterminated tail is not projected.
- `ReadProof` records opened/completed file stamps, bytes read, safe offset, content digest, and safe-prefix digest.
- Device/inode identity is used on Unix; other platforms retain deterministic path identity.

### Scan failure semantics

- Missing/non-directory root and traversal failure are fatal source errors.
- Per-file stat/path/accepted-metadata errors are returned in `SourceScan.failures` and included in snapshot proof.
- Strict sync publishes no partial complete coverage when failures exist.
- Best-effort may commit good files but must not report complete coverage.

### Incremental equivalence

- Checkpoint bytes are opaque outside the adapter.
- Delta is an optimization; full replay defines projection semantics.
- Any source/checkpoint/identity/prefix/cursor uncertainty returns `FullRequired` instead of guessing.
- For the same final raw bytes, delta + base must equal full replay.

## Codex adapter

Implementation: `src/sources/codex.rs`.

Accepted metadata/profile input:

- `session_meta`: id, cwd, and whether `history_base` declares a pagination segment;
- `turn_context`: model, cwd, and turn id;
- explicit turn start/end/abort/rollback events: a message-pair boundary only, no body;
- `compacted.message` -> session `compactText`;
- `response_item/reasoning.summary` -> session `reasoningSummaryText`.

Accepted message input:

- Legacy `event_msg/user_message` and `event_msg/agent_message`;
- `response_item/message` with role `user` or `assistant`, non-empty text and record timestamp;
- only `input_text` / `output_text` content parts. For user parts with `content_item_kinds`, accept only `user.text`; unknown, missing, or malformed classifications are excluded. Without classifications, recognized injected-context envelopes are excluded by prefix;
- developer/system/tool content, encrypted agent-message envelopes, unknown content types and internal approval/evaluation messages are excluded. Rejected bodies do not enter inventory fingerprints or evidence.

The two message encodings can mirror one conversational message. Consecutive accepted records with the same role and exact text, from opposite encodings, form one pair: preserve the first record's text, timestamp and raw locator. Pair once, then reset. Same-encoding repetition, different text, different roles and messages across explicit turn/compaction boundaries remain distinct. This bounded pairing state survives an append checkpoint; it is not session-level or global text deduplication.

### Identity and upgrade

A normal rollout uses its session UUID. A continuation segment keeps the base UUID inside the reducer but uses the trailing UUID of its filename (`rollout-<time>-<base>_<segment>.jsonl`) as its searchable identity whenever that differs from the session UUID, whether or not its `session_meta` carries `history_base` (older segments omit it). A `history_base` segment without a distinct filename UUID falls back to its filename stem. Finishing a delta never mutates the base identity. Each segment has its own `sessionRef`, seq numbering and file locator; no cross-file message stitching is implied.

`ACCEPTED_PREFIX` is the single Codex interpretation marker. It versions both accepted-record fingerprints and serialized reducers. A changed marker invalidates inventory caches and makes all older reducers request full replay, including nonempty EOF cursors. When that replay projects a file under a different session identity than it was indexed as (v4: older segments indexed under their base UUID), the old session held by that path is replaced, and its binding no longer makes another staged file with the old identity a duplicate. Unchanged current files remain no-ops. A valid empty cursor may append its first message and create a session at seq zero without replaying an already understood prefix.

### Storage forms

A Codex rollout is either plain `rollout-*.jsonl` or, after Codex compresses an idle rollout, `rollout-*.jsonl.zst`: one zstd stream of the exact plain bytes, published under its final name only when complete (Codex writes a temporary file and renames it), after which Codex removes the plain file. Resuming the thread decompresses it back to plain JSONL first. Both forms are accepted under any synced root, including `~/.codex/archived_sessions`; registered cold roots stay presence-only (see `docs/COLD_RETENTION.md`).

- Only the exact `.jsonl.zst` suffix is decoded. Other `.zst` names, and Codex's in-flight `*.compress.*.tmp` files, are not source files.
- While both forms of one rollout exist (mid-compression or mid-resume), the scan reads the plain file and ignores the compressed twin, as Codex does. One rollout is therefore one source file, independent of traversal order.
- Decoding streams through the shared bounded zstd reader: content projection reads no compressed bytes beyond the captured limit, the decoder keeps zstd's default window limit (a frame that demands more is a hard per-file error), and only the current record is buffered. Decompressed records go through the same allowlist as plain records; inventory fingerprints cover accepted records only, so both forms of one rollout have the same accepted metadata.
- Document locators of a compressed rollout are offsets in its decompressed stream, which is the plain rollout byte for byte. Both forms of one rollout project identical sessions and documents; only `filePath` differs.
- A compressed rollout is immutable, so it never appends: an offered checkpoint returns `DeltaUnsupported` and the file is replayed in full. The checkpoint and read proof cover the compressed bytes. Because the file is published whole by rename, a torn final frame means it was cut (interrupted copy, disk-full restore) and is a hard per-file error like any other decode failure, never a silent prefix. (DSH, which appends frames in place, keeps its torn-tail tolerance.)
- A rollout moving between forms is a session move: the session keeps its row and identity, its stored path moves to the projected file, and the cursor bound at the twin path is dropped in the same transaction. The twin counts as superseded even while it still exists, because the scan never selects both forms; any other still-existing path bound to the same session makes the staged file a refused duplicate, as for any move. For `--prune`, a selected file also retains its twin path, so a session still bound to a shadowed compressed twin is kept when the plain file is left out of the write (deferred while Codex appends, invalid, or a refused duplicate).

Codex is the only adapter currently implementing true append delta. File identity change, invalid/old reducer, cursor mismatch, prefix rewrite or base-session identity change requires full replay. Tests compare incremental and fresh projections after each record in a mixed-format trace, across pagination append, during interpretation upgrades, and over a bounded exhaustive set of plain/compressed storage-move sequences (with and without prune). The broader property/state-machine matrix remains future work.

## Claude Code adapter (experimental)

Implementation: `src/sources/claude_code.rs`.

Accepted:

- top-level record type `user` or `assistant`;
- direct `content` string, or `message.content` string/array;
- only array items with `type = "text"`;
- accepted record timestamp/sessionId/cwd metadata.

Rejected:

- `isMeta = true`;
- `isSidechain = true`;
- non-user/assistant record types;
- tool/thinking/attachment-like non-text content parts;
- empty extracted text;
- malformed/non-object lines.

Claude Code currently requests full replay when an existing checkpoint is offered (`DeltaUnsupported`). Do not describe it as append-incremental yet.

## Pi adapter (experimental)

Implementation: `src/sources/pi.rs`.

Accepted metadata/profile input:

- `session` record with non-empty cwd and timestamp; id when available;
- latest `model_change` model id;
- `compaction` record with non-empty summary -> session `compactText`.

Accepted message input:

- `message.message.role = user | assistant`;
- content string/array;
- array strings or objects with `type = "text"` only;
- timestamp from record or nested message.

Rejected:

- tool-result roles;
- tool-call/thinking/unsupported content parts;
- incomplete session/compaction/message records;
- malformed/non-object lines.

Pi currently requests full replay when an existing checkpoint is offered (`DeltaUnsupported`).

## DSH adapter (experimental)

Implementation: `rust/src/sources/dsh.rs`.

Source layout: `~/.dsh/sessions/<encoded-cwd>/<session-id>/session.jsonl.zstd`. The file is zstd-compressed JSONL; the adapter treats the compressed file as the raw source and streams decompressed records. Scan accepts only `.zstd`/`.zst` files; an uncompressed `.jsonl` in the tree is skipped as format drift, not decoded.

DSH session archiving is a workspace UI flag (`~/.dsh/storages/workspace.json` `archivedSessionIds`); archived session files stay in place under the sessions root, so they remain indexed and searchable. Sherlog does not read or replicate the archive flag.

Accepted metadata/profile input:

- `session` record with non-empty cwd and `createdAt` epoch millis -> ISO timestamp; id when available (fallback: the session directory name);
- latest `session/title` non-empty title (the first title is a truncated paste of the first user message; later records carry the refined title);
- latest `request/header` non-empty `data.header.config.model` (the model can switch mid-session).

Accepted message input:

- `user/message` only when `data.source.kind == "user"` (real user turns; injected plugin/skill-catalog/agent-instructions/subagent context is rejected);
- `assistant/message` with `data.message.role == "assistant"`;
- `content[]` items with `type = "text"` only;
- timestamp from record `time` epoch millis.

Rejected:

- user messages with non-`user` source kind (system/runtime injections);
- reasoning, tool-call, tool-result, and unsupported content parts;
- incomplete session/message records;
- malformed/non-object lines.

DSH currently requests full replay when an existing checkpoint is offered (`DeltaUnsupported`). Raw byte locators are `0` because decompressed JSONL offsets are not positions in the compressed file; `read-*` serves text from SQLite. (Codex compressed rollouts keep decompressed offsets instead, because those equal the plain rollout's offsets; see Codex storage forms.)

A torn final zstd frame (interrupted or in-flight write; DSH repairs torn tails itself) ends the decodable record stream without failing the file: the complete prefix is projected, and the next sync replays in full once the file is repaired. Any other decode failure (corrupt header, corrupt block, bad frame parameter) remains a hard per-file error.

## Derived profile fields

When upstream data does not provide a stable generated profile, the adapter may derive:

- title from the first accepted user message;
- summary from bounded first/latest user/assistant accepted messages;
- start/end time from accepted records with deterministic fallback.

Derived values must use accepted projection only. A private/rejected append must not alter searchable metadata.

## Storage contract

Adapters never write SQLite directly. Sync maps adapter output to:

- `session_rows` / public `sessions` view;
- message and session-profile rows in `documents`;
- `documents_fts`;
- append proof in `source_files`;
- `coverage` only after complete snapshot proof.

This locality matters: source adapters decide what is safe to project; index decides how projection persists; retrieval decides how candidates rank.

## Current limits

- Synthetic/contract fixtures cover accepted and rejected shapes, not every upstream raw variant.
- Experimental source readers may change as upstream formats move.
- Cold-presence destructive prune currently has a reliable filename identity mapping only for Codex.
- No watcher/daemon consumes upstream changes automatically.
- No adapter may use raw grep to bypass projection privacy.
