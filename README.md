# cxs

[https://cxs.chen.rs](https://cxs.chen.rs)

`cxs` is a local-first CLI for searching local Codex and Claude Code session
logs. It is built for agents that know how to investigate: find the right
session first, then read only the relevant range or page.

The public session sources in this checkout are `codex` and experimental
`claude-code`. `find` searches all public indexed sources by default so agents
do not have to guess where a memory came from. Other fixed commands still treat
omitted `--source` as Codex unless they receive a source-qualified session ref
such as `claude-code:<id>`. Claude Code support is public in this checkout, but
it is still an experimental transcript-reader contract rather than a stable
raw-format promise.

When reading this from a source checkout, the installed `cxs` on your `PATH`
may still be an older npm release. Check `cxs status --help` before using
`--source`; if help does not list `--source`, omit source flags or update the
installed CLI from a release that includes source-aware behavior.

Core workflow:

```text
status -> ensure selector coverage -> find/list -> read-range/read-page
```

## Why CXS?

`cxs` searches your local Codex and Claude Code session history. It turns past conversations into instantly queryable runbooks. 

For a deep dive into why we use FTS instead of Embeddings, why it's better than `rg`, and our design principles, read the [Design Philosophy](docs/PHILOSOPHY.md).

## What It Is

- A CLI for indexed search over local Codex and Claude Code session logs.
- A retrieval backend for agents, sidecars, and local tools that need session recall.
- A manual-sync tool: `sync` is the only command that writes the SQLite index.

## What It Is Not

- Not a GUI.
- Not a watcher, daemon, or realtime sync service.
- Not a live in-flight thread attachment layer.
- Not a default full-transcript dumper.

## Install

Requirements:

- macOS or Linux. Windows users should use WSL.
- Node.js `>= 22`.
- Read access to local session logs, such as `~/.codex/sessions` and
  `~/.claude/projects`.

Install the CLI globally:

```bash
npm i -g @act0r/cxs
cxs --help
```

The installed command is `cxs`. The package is scoped because the unscoped
`cxs` package name is already taken on npm. The current distribution is the npm
package only; no standalone binary is published.

For one-off usage:

```bash
npx @act0r/cxs@latest --help
npx @act0r/cxs@latest status --json
```

Install the agent skill separately:

```bash
npx skills add catoncat/cxs --full-depth --skill cxs -g -y
```

The npm package installs the `cxs` CLI only. It does not install the agent
skill. The skill also does not install the CLI; it calls `CXS_BIN` when set and
otherwise expects `cxs` to be available on `PATH`. Restart Codex or open a new
session after installing or updating the skill.

## Quick Start

Inspect the default source inventory and index coverage:

```bash
cxs status --json
```

Check coverage for a project:

```bash
cxs status --cwd /Users/you/work/project --json
```

If `requestedCoverage.recommendedAction` is `"sync"`, build or refresh coverage:

```bash
cxs sync --cwd /Users/you/work/project
```

Replace the example paths with your own absolute paths.

Search and read progressively:

```bash
cxs find "health check"
cxs read-range <sessionRef> --seq <matchSeq>
cxs read-page <sessionRef> --offset 0 --limit 20
```

You can run the same flow without global installation:

```bash
npx @act0r/cxs@latest sync --root /Users/you/.codex/sessions
npx @act0r/cxs@latest find "health check" --root /Users/you/.codex/sessions
```

## Commands

| Command | Purpose |
| --- | --- |
| `cxs status` | Show execution context, source inventory, index state, and coverage. `--selector` checks whether a target range is fresh. Does not write the index. |
| `cxs sync --root <dir>\|--cwd <path>\|--selector <json>` | Scan selected sessions for the chosen source and update the SQLite index. This is the only write command. |
| `cxs find <query>` | Search indexed sessions across all public sources by default and return ranked session candidates with minimal snippets. Use `--source <id>` to narrow, or `--root`, `--cwd`, and `--sort ended` for scoped "latest + keyword" queries. |
| `cxs read-range <sessionUuid>` | Read a small message window around a matched sequence or in-session query. |
| `cxs read-page <sessionUuid>` | Read a session page by offset and limit. |
| `cxs list` | List indexed sessions without full-text search. |
| `cxs stats` | Show index statistics. |

All commands that read indexed content support `--json`. Read commands fail
cleanly if the index has not been created yet.

In source-aware builds, all fixed commands accept `--source <id>`. Public
values are `codex` and experimental `claude-code`.

`find` is the recall primitive and defaults to all public indexed sources:

```bash
cxs find "health check"
cxs find "health check" --source all
```

Use a source only to narrow or diagnose:

```bash
cxs find "health check" --source codex
cxs find "health check" --source claude-code
```

For `status`, `sync`, `list`, `stats`, and bare read commands, omitting
`--source` still means Codex. Read commands can also consume the `sessionRef`
returned by `find` directly:

```bash
cxs status --source claude-code --json
cxs sync --source claude-code --root ~/.claude/projects --json
cxs read-range claude-code:<sessionId> --seq <matchSeq>
```

Unknown sources still return `unsupported_source` before doing command work.
Claude Code remains experimental public support: the current adapter is built
around the existing local transcript reader, validated with synthetic fixtures,
and may still evolve toward a more stable SDK/session API contract. If an
installed CLI rejects the `--source` option itself, that installation predates
this behavior; update the CLI or run the checkout with `npm run cxs -- ...`.

## Selectors

`sync` requires an explicit scope, but it no longer requires handwritten
`root` inside selector JSON. Prefer these CLI shortcuts:

```bash
cxs sync --root /Users/you/.codex/sessions
cxs sync --cwd /Users/you/work/project
cxs find "health check" --cwd /Users/you/work/project --sort ended
cxs list --root /Users/you/.codex/sessions --sort ended -n 10
```

Use full selector JSON for date ranges or advanced scopes. If you pass
`--root`, the selector JSON may omit `root`; without `--root`, cxs uses the
default source root. Selector JSON may also omit `source`; canonical selectors
include the resolved source id in this checkout.

```text
{"source":"codex","kind":"all","root":"/Users/you/.codex/sessions"}
{"source":"codex","kind":"date_range","root":"/Users/you/.codex/sessions","fromDate":"2026-04-01","toDate":"2026-04-30"}
{"source":"codex","kind":"cwd","root":"/Users/you/.codex/sessions","cwd":"/Users/you/work/project"}
{"source":"codex","kind":"cwd_date_range","root":"/Users/you/.codex/sessions","cwd":"/Users/you/work/project","fromDate":"2026-04-01","toDate":"2026-04-30"}
```

Example list query scoped to one project:

```bash
cxs list --selector '{"kind":"cwd","root":"/Users/you/.codex/sessions","cwd":"/Users/you/work/project"}' --sort ended -n 10
cxs list --selector '{"kind":"cwd","cwd":"/Users/you/work/project"}' --sort ended -n 10
```

Example latest keyword query, excluding the current self-hit:

```bash
cxs find "xsearch" --cwd /Users/you/work/project --sort ended --exclude-session <current_session_uuid> -n 5 --json
```

`find` defaults to relevance sorting. Do not treat default `find` order as time
order.

## Sync And Storage

By default, source-scoped commands read Codex sessions from
`~/.codex/sessions`. With `--source claude-code`, the default root is
`~/.claude/projects`. `find` defaults to searching all public indexed sources
already present in the SQLite index. Index data is stored at:

```text
~/.local/state/cxs/index.sqlite
```

`$XDG_STATE_HOME` is respected, and `CXS_DATA_DIR` has the highest priority:

```bash
export CXS_DATA_DIR="$HOME/.config/cxs"
```

Sync is strict by default. If any selected file fails to parse or write, `sync`
exits non-zero with per-file diagnostics and does not commit partial coverage.
On success, strict sync updates the selected index slice for files that are
currently visible in the source snapshot and writes complete coverage for that
snapshot. Previously indexed sessions whose source JSONL later disappears are
retained by default, so raw log maintenance does not make historical `cxs find`
or `read-*` results disappear.
Pass `--prune` only when you explicitly want to delete indexed sessions that are
no longer present in the selected source snapshot.
Pass `--best-effort` only when you explicitly want successful files written
despite failures; best-effort sync does not record complete coverage.

`sync` is not required before every query. Use `status --cwd` or
`status --selector` to check coverage first. A fresh `{"kind":"all", ...}`
coverage record covers narrower selectors under the same source and root; a high
`stats.sessionCount` only means rows exist and is not itself a freshness proof.

Indexes created before `cxs-v7-source-identity` should be refreshed with
`sync --root`, `sync --cwd`, or `sync --selector` so selector coverage and reads
use source-aware identity, current `path_date`, and source-root provenance
fields. Source-aware read commands do not migrate old indexes because they are
read-only; they return `index_schema_upgrade_required` with a `cxs sync` hint
when the index needs this refresh.

Older `cxs <= 0.2.0` indexes stored under `~/.cache/cxs/` are migrated
automatically on first run when the new state directory is empty. If the new
directory already has data, migration is skipped and the old cache is left in
place.

## Retrieval Model

The current retrieval chain is:

```text
message/session recall -> session heuristic rerank -> read-range/read-page
```

Implemented recall surfaces:

- `messages_fts` over real user and assistant messages.
- `sessions_fts` over `title + summary_text + compact_text + reasoning_summary_text`.
- Session-level FTS weights: title `8.0`, compact `4.0`, summary `3.0`, reasoning summary `1.2`.
- A small LIKE fallback for rare zero-token CJK message queries.

`find` returns enough context to choose the next read step. If a result only
matches session-level fields, it is marked with `matchSource = "session"` and
has no message anchor; use `read-page` for those results.

Not implemented yet:

- Resource-level reranking.
- Richer projection or event replay.
- Range cache.
- Duplicate-family collapse or diversity control.
- Strong gold-set acceptance suite.
- Stable Claude Code raw transcript format contract.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Roadmap:
[docs/ROADMAP.md](docs/ROADMAP.md).

## Development

Run from source:

```bash
git clone https://github.com/catoncat/cxs.git
cd cxs
npm install
npm run cxs -- --version
```

Use `npm run cxs -- ...` to verify checkout behavior. A globally installed
`cxs` command may still be an older npm release until a separate release and
install workflow updates it.

Common checks:

```bash
npm run check
npm run eval:manual
npm run eval:compare -- data/cxs-eval/<before-batch> data/cxs-eval/<after-batch>
```

`npm run check` runs TypeScript and Vitest. `eval:manual` exports manual eval
results; `eval:compare` compares two eval batches.

Project rules and contribution notes:

- [AGENTS.md](AGENTS.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)

## Agent Skill Package

This repository also publishes an installable agent skill package:

```text
skill-packages/cxs
```

Install or update it with:

```bash
npx skills add catoncat/cxs --full-depth --skill cxs -g -y
```

List available skills in the repository:

```bash
npx skills add catoncat/cxs --full-depth --list
```

Important boundaries:

- `npx skills add` installs the agent skill only; it does not install the `cxs` CLI.
- Install the CLI with `npm i -g @act0r/cxs`, use `npx @act0r/cxs@latest`, or set `CXS_BIN` for the skill.
- Restart Codex or open a new session after installing or updating the skill.
