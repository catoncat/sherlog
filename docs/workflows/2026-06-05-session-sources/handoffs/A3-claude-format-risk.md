# A3 Handoff: Claude Code Format Risk Packet

Thread: `019e96fb-47ef-7531-a6ef-918b1b9f3209`
Status: completed
Mode: `decision-packet`

## Conclusion

Reserve Claude Code as a future source adapter, but do not publish adapter behavior in this workflow. Stable enough to reserve now: `source = "claude-code"`, source registry shape, selector/coverage source dimension, and adapter-owned transcript decoding. Not stable enough to treat as public contract: raw JSONL schema details such as `isMeta`, `isSidechain`, `parentUuid`, attachments, tool payloads, and title events.

## Official Evidence

Worker used current Claude Code / Agent SDK documentation and found:

- Claude Code session transcripts are stored under `~/.claude/projects/<encoded-cwd>/*.jsonl`.
- Resume behavior depends on matching `cwd`.
- Local transcript store is plaintext and used for session resumption; cleanup period is configurable.
- Agent SDK exposes session/message APIs such as session listing and message retrieval.
- Message concepts include system, assistant, user, stream/result messages; assistant/user content may include tool calls/results.
- `--no-session-persistence` is a valid mode, so local transcript absence is normal.

## Local Structural Sampling

Worker inspected only structural field names/counts under `~/.claude/projects`; no transcript text, tool output, paths from records, or secrets were copied. Sample shape included event types such as `user`, `assistant`, `system`, `attachment`, `ai-title`, and content item types such as `text`, `tool_use`, `tool_result`.

This is risk evidence only, not a stable schema guarantee.

## Reserved Boundary

- Core cxs should only understand canonical parsed sessions/messages and source identity.
- Future Claude adapter owns raw JSONL/SDK decoding and filtering.
- `cwd` is stable enough as selector metadata.
- Timestamp is display/order metadata when parseable.
- Title should be optional metadata, never required.
- `tool_use`, `tool_result`, attachments, `isMeta`, `isSidechain`, and `parentUuid` stay adapter-private/deferred initially.

## Parser Recommendations

- Add no Claude parser now.
- Future Claude parser should allowlist only user/assistant text for canonical messages.
- Skip `isMeta === true`.
- Exclude `isSidechain === true` until subagent semantics are designed.
- Extract text only from string content or text blocks.
- Do not index tool result bodies, attachments, diagnostics, snapshots, hook payloads, signatures, or thinking by default.
- Preserve `parentUuid` only as metadata; do not use it as cxs session identity.
- Use JSONL file order as `seq`; timestamps for started/ended/display.
- Unknown/malformed records should skip rather than fail outside strict mode.

## Decisions Needed

D1 should choose whether future Claude support is SDK-reader first or raw-JSONL adapter first. Worker recommends SDK-reader first for public behavior, raw JSONL only for adapter tests/audit mode, because official docs treat store entries as opaque JSON-safe values.

## Noise / Efficiency / Tool Fit

- `noise_events`: worker was on detached HEAD; unrelated Mainline status noise was not acted on.
- `efficiency_notes`: web browsing was necessary because Claude Code docs are current/drift-prone.
- `tool_fit`: orchestrator + official docs + structural-only local sampling fit the decision-packet.
