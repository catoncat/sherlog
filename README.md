# Sherlog

[https://sherlog.net](https://sherlog.net)

`Sherlog` is a local-first CLI for searching local Codex, Claude Code, and Pi session logs. It is built for agents that know how to investigate: find the right session first, then read only the relevant range or page.

## Quick Install

Install the CLI globally:

```bash
npm i -g @act0r/sherlog
shlog --help
```

Install the agent skill separately:

```bash
npx skills add -g catoncat/sherlog
```

## Quick Start

Initialize the default Codex index:

```bash
shlog sync
```

Search and read progressively:

```bash
shlog find "health check"
shlog read-range <sessionRef> --seq <matchSeq>
shlog read-page <sessionRef> --offset 0 --limit 20
```

If `find` prints `next:` or JSON includes `nextAction`, refresh the suggested coverage and retry before treating the results as complete. This can happen even when `find` returns non-empty results.

For project-scoped agent work, check and refresh only that coverage:

```bash
shlog status --cwd /Users/you/work/project --json
shlog sync --cwd /Users/you/work/project
```

## Documentation

- [Design Philosophy](docs/PHILOSOPHY.md) - Why FTS? Why not `ripgrep` or embeddings?
- [Usage Guide](docs/USAGE.md) - Full commands, selectors, sync, and storage details.
- [Architecture](docs/ARCHITECTURE.md) - Retrieval model and how it works under the hood.
- [Roadmap](docs/ROADMAP.md) - What's coming next.
- [Agent Rules](AGENTS.md) - Project rules and contribution notes.
