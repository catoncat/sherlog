# cxs

[https://cxs.chen.rs](https://cxs.chen.rs)

`cxs` is a local-first CLI for searching local Codex and Claude Code session logs. It is built for agents that know how to investigate: find the right session first, then read only the relevant range or page.

## Quick Install

Install the CLI globally:

```bash
npm i -g @act0r/cxs
cxs --help
```

Install the agent skill separately:

```bash
npx skills add catoncat/cxs --full-depth --skill cxs -g -y
```

## Quick Start

Check coverage for a project:

```bash
cxs status --cwd /Users/you/work/project --json
```

Build or refresh coverage:

```bash
cxs sync --cwd /Users/you/work/project
```

Search and read progressively:

```bash
cxs find "health check"
cxs read-range <sessionRef> --seq <matchSeq>
cxs read-page <sessionRef> --offset 0 --limit 20
```

## Documentation

- [Design Philosophy](docs/PHILOSOPHY.md) - Why FTS? Why not `ripgrep` or embeddings?
- [Usage Guide](docs/USAGE.md) - Full commands, selectors, sync, and storage details.
- [Architecture](docs/ARCHITECTURE.md) - Retrieval model and how it works under the hood.
- [Roadmap](docs/ROADMAP.md) - What's coming next.
- [Agent Rules](AGENTS.md) - Project rules and contribution notes.
