# Verification Runbook

status: `planned`

This runbook turns the milestone gates into concrete proof contracts. It is not
evidence by itself. A worker or controller must paste decisive command results
into the relevant handoff before a gate can be considered passed.

## General Proof Rules

- Run commands from the relevant worker worktree unless the gate explicitly
  verifies the installed global CLI.
- Record exact command, exit status, and decisive output summary.
- Do not use real Claude transcript content for fixtures, debug output, or
  pasted proof.
- Treat a broad green test run as supporting evidence only; it does not replace
  focused proof for selector/source, privacy, public boundary, release, or
  install state.
- If a command cannot run, record why and keep the gate incomplete.

## C1 Private Adapter Rework Proof

Required from `handoffs/C1-private-adapter-rework.md`:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current || true
git rev-parse HEAD
git status --short
npm run check
git diff --check
git status --short
```

Focused tests must prove:

- explicit selector source mismatch is rejected before Claude inventory,
  snapshot, sync, coverage, count, or prune can proceed;
- skipped/meta/sidechain-first records cannot set session identity, `cwd`,
  timestamps, inventory grouping, source fingerprints, coverage freshness, or
  read projections;
- public CLI rejects `--source claude-code`;
- selector JSON requesting `claude-code` is rejected on public CLI;
- existing Codex default behavior still works.

Synthetic smoke requirements:

- use only synthetic Claude-shaped JSONL under a temp directory;
- sync through the private adapter path;
- read/search the synthetic private data enough to prove the adapter path works;
- prove skipped synthetic sentinel strings are absent from searchable/read
  projections and metadata.

Handoff must include the exact test names or CLI commands used for each bullet.

## R2 Post-Rework Review Proof

Required review evidence:

```bash
git status --short
git diff --stat
git diff -- src/ test/ docs/ skill-packages/ package.json package-lock.json pnpm-lock.yaml 2>/dev/null || true
```

Review must classify:

- W1B P1 selector/source mismatch: fixed or still open.
- W1B P1 skipped-record parser metadata risk: fixed or still open.
- W1B P1 inventory metadata risk: fixed or still open.
- Public CLI boundary: intact or broken.
- Real transcript exposure: absent or blocker.
- Candidate drift from `1a080b1`: preserved current main or regressed.

R2 may not approve progression to V1 with unresolved P1 findings.

## V1 Verification Gate Proof

Required current-checkout commands:

```bash
npm run check
npm run shlog -- --help
npm run shlog -- status --json
git diff --check
git status --short
```

Required focused smoke:

- Codex default smoke using current checkout and synthetic/temp selector where
  possible.
- Public rejection smoke for `claude-code`.
- Private Claude synthetic-fixture sync/read smoke if C1 added a private
  adapter path.
- Evidence that any timeout changes are necessary and scoped, or that no timeout
  change remains.

V1 must update `completion-audit.md` rows only when evidence directly proves
the row's requirement.

## D1 Docs Proof

Required docs checks:

```bash
git diff -- docs/ README.md AGENTS.md skill-packages/sherlog 2>/dev/null || true
git diff --check
```

Docs review must prove:

- current-state docs match source behavior;
- private vs public Claude wording is accurate;
- fixed command surface remains accurate;
- release/install layers remain separate;
- no docs imply registry or local install state that has not happened.

## S1 Skill Source Proof

Required checks:

```bash
git diff -- skill-packages/sherlog
npx skills ls -g --json
```

Additional proof depends on the skill packaging available at that time:

- verify the skill source references the correct CLI entrypoint contract;
- verify it says the skill install does not install the CLI;
- verify dogfood/dev-only workflow stays out of public skill source;
- verify any Claude Code instructions match the public promotion state.

Do not update the global skill from a dirty checkout.

## L1 Commit And Mainline Proof

Required before commit:

```bash
git status --short --untracked-files=all
npm run check
git diff --check
```

Required lifecycle evidence after the user boundary allows lifecycle actions:

```bash
git add <scoped-files>
git commit -m "<type>(scope): <summary>"
mainline seal --prepare --json > .ml-cache/seal.json
mainline seal --submit --json < .ml-cache/seal.json
mainline lint <intent-id> --json
```

If `mainline seal --submit` reports conflicts, surface them before proceeding.

## P1 Release Proof

Required only after L1 passes and release is authorized:

```bash
git status --short
git log -1 --oneline
npm view @act0r/sherlog version
```

Release-session proof must also include:

- pushed branch/main readback;
- tag or release workflow identifier;
- GitHub Actions result;
- registry version after publish;
- package/version expected by release commit.

Do not call source checkout behavior released until registry readback proves it.

## I1 Installed Smoke Proof

Required only after registry publication:

```bash
command -v shlog
which -a shlog
shlog --version
shlog status --json
```

Installed smoke must prove:

- PATH resolves to the intended installed binary;
- installed version equals the registry version;
- SQLite/native addon loads in the installed CLI;
- Codex default behavior works in the installed CLI;
- if Claude Code is public by then, installed public CLI smoke covers it with
  synthetic fixtures only.

Global skill update, if needed, must use:

```bash
npx skills add catoncat/sherlog --full-depth --skill sherlog -g -a codex -y
```

Then verify the installed skill and CLI behavior are aligned.

## Completion Check

Before any final "complete" claim:

1. Read `completion-audit.md`.
2. For every row not marked `proved`, collect missing evidence or keep the goal
   active.
3. Re-run the evidence commands for any row whose proof may have drifted.
4. Confirm release, registry, installed CLI, and global skill state separately.
