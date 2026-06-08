# Sherlog Usage Guide

## Commands

| Command | Purpose |
| --- | --- |
| `shlog status` | Show execution context, source inventory, index state, and coverage. `--selector` checks whether a target range is fresh. Does not write the index. |
| `shlog sync --root <dir>\|--cwd <path>\|--selector <json>` | Scan selected sessions for the chosen source and update the SQLite index. This is the only write command. |
| `shlog find <query>` | Search indexed sessions across all public sources by default and return ranked session candidates with minimal snippets. Use `--source <id>` to narrow, or `--root`, `--cwd`, and `--sort ended` for scoped "latest + keyword" queries. |
| `shlog read-range <sessionUuid>` | Read a small message window around a matched sequence or in-session query. |
| `shlog read-page <sessionUuid>` | Read a session page by offset and limit. |
| `shlog list` | List indexed sessions without full-text search. |
| `shlog stats` | Show index statistics. |

All commands that read indexed content support `--json`. Read commands fail cleanly if the index has not been created yet.

In source-aware builds, all fixed commands accept `--source <id>`. Public values are `codex` and experimental `claude-code`.

`find` is the recall primitive and defaults to all public indexed sources:

```bash
shlog find "health check"
shlog find "health check" --source all
```

Use a source only to narrow or diagnose:

```bash
shlog find "health check" --source codex
shlog find "health check" --source claude-code
```

For `status`, `sync`, `list`, `stats`, and bare read commands, omitting `--source` still means Codex. Read commands can also consume the `sessionRef` returned by `find` directly:

```bash
shlog status --source claude-code --json
shlog sync --source claude-code --root ~/.claude/projects --json
shlog read-range claude-code:<sessionId> --seq <matchSeq>
```

Unknown sources still return `unsupported_source` before doing command work. Claude Code remains experimental public support: the current adapter is built around the existing local transcript reader, validated with synthetic fixtures, and may still evolve toward a more stable SDK/session API contract. If an installed CLI rejects the `--source` option itself, that installation predates this behavior; update the CLI or run the checkout with `npm run shlog -- ...`.

## Selectors

`sync` requires an explicit scope, but it no longer requires handwritten `root` inside selector JSON. Prefer these CLI shortcuts:

```bash
shlog sync --root /Users/you/.codex/sessions
shlog sync --cwd /Users/you/work/project
shlog find "health check" --cwd /Users/you/work/project --sort ended
shlog list --root /Users/you/.codex/sessions --sort ended -n 10
```

Use full selector JSON for date ranges or advanced scopes. If you pass `--root`, the selector JSON may omit `root`; without `--root`, shlog uses the default source root. Selector JSON may also omit `source`; canonical selectors include the resolved source id in this checkout.

```text
{"source":"codex","kind":"all","root":"/Users/you/.codex/sessions"}
{"source":"codex","kind":"date_range","root":"/Users/you/.codex/sessions","fromDate":"2026-04-01","toDate":"2026-04-30"}
{"source":"codex","kind":"cwd","root":"/Users/you/.codex/sessions","cwd":"/Users/you/work/project"}
{"source":"codex","kind":"cwd_date_range","root":"/Users/you/.codex/sessions","cwd":"/Users/you/work/project","fromDate":"2026-04-01","toDate":"2026-04-30"}
```

Example list query scoped to one project:

```bash
shlog list --selector '{"kind":"cwd","root":"/Users/you/.codex/sessions","cwd":"/Users/you/work/project"}' --sort ended -n 10
shlog list --selector '{"kind":"cwd","cwd":"/Users/you/work/project"}' --sort ended -n 10
```

Example latest keyword query, excluding the current self-hit:

```bash
shlog find "xsearch" --cwd /Users/you/work/project --sort ended --exclude-session <current_session_uuid> -n 5 --json
```

`find` defaults to relevance sorting. Do not treat default `find` order as time order.

## Sync And Storage

By default, source-scoped commands read Codex sessions from `~/.codex/sessions`. With `--source claude-code`, the default root is `~/.claude/projects`. `find` defaults to searching all public indexed sources already present in the SQLite index. Index data is stored at:

```text
~/.local/state/shlog/index.sqlite
```

`$XDG_STATE_HOME` is respected, and `SHLOG_DATA_DIR` has the highest priority. `CXS_DATA_DIR` still works as a legacy alias:

```bash
export SHLOG_DATA_DIR="$HOME/.config/shlog"
```

Sync is strict by default. If any selected file fails to parse or write, `sync` exits non-zero with per-file diagnostics and does not commit partial coverage. On success, strict sync updates the selected index slice for files that are currently visible in the source snapshot and writes complete coverage for that snapshot. Previously indexed sessions whose source JSONL later disappears are retained by default, so raw log maintenance does not make historical `shlog find` or `read-*` results disappear.
Pass `--prune` only when you explicitly want to delete indexed sessions that are no longer present in the selected source snapshot.
Pass `--best-effort` only when you explicitly want successful files written despite failures; best-effort sync does not record complete coverage.

`sync` is not required before every query. Use `status --cwd` or `status --selector` to check coverage first. A fresh `{"kind":"all", ...}` coverage record covers narrower selectors under the same source and root; a high `stats.sessionCount` only means rows exist and is not itself a freshness proof.

Indexes created before `shlog-v7-source-identity` should be refreshed with `sync --root`, `sync --cwd`, or `sync --selector` so selector coverage and reads use source-aware identity, current `path_date`, and source-root provenance fields. Existing `cxs-v7-source-identity` indexes remain readable as a compatibility path. Source-aware read commands do not migrate old indexes because they are read-only; they return `index_schema_upgrade_required` with a `shlog sync` hint when the index needs this refresh.

Older `Sherlog <= 0.2.0` indexes stored under `~/.cache/cxs/` and state dirs under `~/.local/state/cxs/` are migrated automatically on first run when the new state directory is empty. If the new directory already has data, migration is skipped and the old location is left in place.

## Agent Skill Package

This repository also publishes an installable agent skill package:

```text
skill-packages/sherlog
```

Install or update it with:

```bash
npx skills add catoncat/sherlog --full-depth --skill sherlog -g -a codex -y
```

List available skills in the repository:

```bash
npx skills add catoncat/sherlog --full-depth --list
```

Important boundaries:

- `npx skills add` installs the agent skill only; it does not install the `shlog` CLI.
- Install the CLI with `npm i -g @act0r/sherlog`, use `npx @act0r/sherlog@latest`, or set `SHLOG_BIN` for the skill. `CXS_BIN` remains supported as a legacy alias.
- Restart Codex or open a new session after installing or updating the skill.
