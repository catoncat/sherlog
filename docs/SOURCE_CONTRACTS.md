# Source Adapter Contracts

This document describes the searchable projection contract for Sherlog public source adapters. It is not a promise that upstream raw transcript formats are stable. `claude-code` and `pi` remain experimental transcript-reader support until upstream formats and fixtures are stronger.

## Shared Invariants

- Source adapters implement the boundary in `src/sources/types.ts`: root resolution, file collection, inventory, snapshot, and `parseFile`.
- Indexing stores only accepted transcript projections: session metadata, raw user/assistant text where allowed, and a small set of session-level handoff fields.
- Unsupported/private records are filtered by default. Tool outputs, attachments, diagnostics, sidechain/meta records, and thinking blocks must not enter `messages_fts` or `sessions_fts` unless a future issue adds an explicit privacy design.
- Read isolation is source-aware. `sessionRef` values returned by `find` can be passed back to `read-range` or `read-page` without guessing the source.
- Malformed JSONL records are skipped instead of failing the whole file.

## Codex

Accepted projection:

- `session_meta` id and cwd metadata.
- `turn_context` model and cwd metadata.
- `event_msg` records whose payload type is `user_message` or `agent_message` and whose `message` is non-empty text.
- `compacted` payload text as session-level `compactText`.
- `response_item` reasoning summaries as session-level `reasoningSummaryText`.

Rejected projection:

- malformed JSONL lines.
- unrelated record types.
- `event_msg` records with other payload types, including tool-result-like records.
- empty user/assistant messages.
- internal approval/evaluation transcript markers filtered by `looksInternal()`.

## Claude Code

Accepted projection:

- policy-approved user and assistant text records from `claude-code-policy`.
- accepted session id, cwd, and timestamp metadata only from accepted records.

Rejected projection:

- meta records.
- sidechain records.
- tool results.
- thinking blocks.
- attachment-like non-text content.
- skipped records when deriving inventory grouping and snapshots.

## Pi

Accepted projection:

- `session` metadata with id, cwd, and timestamp.
- latest `model_change` model id.
- user/assistant text content from `message` records.
- `compaction` summary text as session-level `compactText`.

Rejected projection:

- tool-result roles.
- tool-call content.
- thinking content.
- unsupported content parts.
- malformed or incomplete records.

## Current Contract Limits

- The contract covers what Sherlog indexes and reads from synthetic fixtures, not every upstream raw variant.
- Do not broaden accepted record classes to improve recall without adding privacy-specific tests first.
- Keep source-specific parser changes paired with negative fixtures that prove private or diagnostic data is still filtered.
