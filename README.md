# Sherlog

[https://sherlog.net](https://sherlog.net)

`Sherlog` is a local-first CLI for searching local Codex and Claude Code session logs. It is built for agents that know how to investigate: find the right session first, then read only the relevant range or page.

## Quick Install

Install the CLI globally:

```bash
npm i -g @act0r/sherlog
shlog --help
```

Install the agent skill separately:

```bash
npx skills add catoncat/sherlog --full-depth --skill sherlog -g -a codex -y
```

## Quick Start

Check coverage for a project:

```bash
shlog status --cwd /Users/you/work/project --json
```

Build or refresh coverage:

```bash
shlog sync --cwd /Users/you/work/project
```

Search and read progressively:

```bash
shlog find "health check"
shlog read-range <sessionRef> --seq <matchSeq>
shlog read-page <sessionRef> --offset 0 --limit 20
```

## Documentation

- [Design Philosophy](docs/PHILOSOPHY.md) - Why FTS? Why not `ripgrep` or embeddings?
- [Usage Guide](docs/USAGE.md) - Full commands, selectors, sync, and storage details.
- [Architecture](docs/ARCHITECTURE.md) - Retrieval model and how it works under the hood.
- [Roadmap](docs/ROADMAP.md) - What's coming next.
- [Agent Rules](AGENTS.md) - Project rules and contribution notes.
