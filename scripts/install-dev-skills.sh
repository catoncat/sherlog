#!/usr/bin/env bash
# Install maintainer-only Sherlog development skills from this checkout.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_FILE="$REPO/dev/skills/sherlog-dogfood/source.md"
TARGET="${SHERLOG_DOGFOOD_SKILL_DIR:-$HOME/.agents/skills/sherlog-dogfood}"

if [ ! -f "$SOURCE_FILE" ]; then
  echo "missing source skill: $SOURCE_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"

if [ -L "$TARGET" ]; then
  rm "$TARGET"
elif [ -e "$TARGET" ]; then
  backup="$TARGET.backup-$(date +%Y%m%d%H%M%S)"
  mv "$TARGET" "$backup"
  echo "backed up existing skill directory: $backup"
fi

mkdir -p "$TARGET"
ln -sfn "$SOURCE_FILE" "$TARGET/SKILL.md"

echo "sherlog-dogfood -> $SOURCE_FILE"
echo "target: $TARGET"
