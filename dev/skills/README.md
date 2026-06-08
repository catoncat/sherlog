# Sherlog Developer Skills

This directory is for maintainer-only skills used while developing this repo.
It is intentionally separate from `skill-packages/`, which is the user-facing
skill package surface installed by:

```bash
npx skills add catoncat/sherlog --full-depth --skill sherlog -g -a codex -y
```

Rules:

- Keep user-facing Sherlog skill sources in `skill-packages/sherlog`.
- Keep maintainer-only workflows here under `dev/skills/`.
- Do not commit private dogfood data; local goldens stay under ignored `data/`.
- Keep maintainer skill source files named something other than `SKILL.md`.
  The install script exposes them as `SKILL.md` only under the local
  `~/.agents/skills/` install path. This prevents generic `skills add` scans
  from discovering maintainer-only skills in this repository.
- Install local maintainer skills with:

```bash
scripts/install-dev-skills.sh
```
