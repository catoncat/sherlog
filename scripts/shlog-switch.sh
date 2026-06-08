#!/usr/bin/env bash
# shlog-switch — 在「项目最新版(dev)」与「发布版(release)」之间切换 Sherlog 的 CLI 与 Skill。
#
# 背景:
#   - 全局 `shlog` 是 pnpm 装的发布版 @act0r/sherlog;dev 时把 PATH 里的 shim 改成
#     exec 本 repo 的 dist/cli.js(首次切 dev 前会备份原始 shim,release 时还原)。
#   - Codex 读 `~/.agents/skills/sherlog`;Claude 读 `~/.claude/skills/sherlog`。
#     dev/release 必须同时切这两个 slot,否则不同 agent 会看到不同 skill 文案。
#
# 用法:
#   scripts/shlog-switch.sh dev                            # CLI + Skill 都切到本 repo 最新(会先 npm run build)
#   scripts/shlog-switch.sh dev --repo /path/to/sherlog    # CLI + Skill 都切到指定 checkout/worktree
#   scripts/shlog-switch.sh release                        # CLI + Skill 都切回发布版
#   scripts/shlog-switch.sh status                         # 查看当前各自处于哪个版本
#   第二参数可限定范围: ... dev cli  /  ... release skill|skills
set -euo pipefail

DEFAULT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="${SHLOG_SWITCH_REPO:-${CXS_SWITCH_REPO:-$DEFAULT_REPO}}"
STATE_DIR="$HOME/.shlog-switch"
mkdir -p "$STATE_DIR"

usage() {
  cat <<'EOF'
用法: shlog-switch {dev|release|status} [cli|skill|skills|both] [--repo <path>]

示例:
  scripts/shlog-switch.sh dev
  scripts/shlog-switch.sh dev --repo /path/to/sherlog-worktree
  scripts/shlog-switch.sh dev cli --repo /path/to/sherlog-worktree
  scripts/shlog-switch.sh dev skill --repo /path/to/sherlog-worktree
  SHLOG_SWITCH_REPO=/path/to/sherlog-worktree scripts/shlog-switch.sh dev
EOF
}

action=status
scope=both
while [ "$#" -gt 0 ]; do
  case "$1" in
    dev|release|status)
      action="$1"
      shift
      ;;
    cli|skill|skills|both)
      scope="$1"
      shift
      ;;
    --repo)
      [ "${2:-}" ] || { echo "✗ --repo 需要路径"; exit 2; }
      REPO="$2"
      shift 2
      ;;
    --repo=*)
      REPO="${1#--repo=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

REPO="$(cd "$REPO" 2>/dev/null && pwd)" || { echo "✗ repo 不存在: $REPO"; exit 1; }
[ -f "$REPO/package.json" ] || { echo "✗ 不是 Sherlog checkout: $REPO"; exit 1; }
[ -d "$REPO/skill-packages/sherlog" ] || { echo "✗ 缺少 skill-packages/sherlog: $REPO"; exit 1; }

# ---- CLI ----
SHIM="$(command -v shlog || true)"
DEV_CLI="$REPO/dist/cli.js"
SHIM_BACKUP="$STATE_DIR/shlog.release-shim"

# ---- Skill ----
CODEX_SKILL="$HOME/.agents/skills/sherlog"
CLAUDE_SKILL="$HOME/.claude/skills/sherlog"
DEV_SKILL="$REPO/skill-packages/sherlog"
RELEASE_SKILL_BACKUP="$STATE_DIR/shlog.release-skill"

note() { printf '  %s\n' "$*"; }

cli_dev_target() {
  [ -n "$SHIM" ] || return 0
  sed -n 's/^# shlog-switch: DEV -> //p' "$SHIM" 2>/dev/null | head -n 1
}

cli_mode() {
  [ -n "$SHIM" ] || { echo "missing"; return; }
  local target
  target="$(cli_dev_target)"
  if [ -n "$target" ]; then
    if [ "$target" = "$REPO" ]; then
      echo "dev ($target)"
    else
      echo "dev-other ($target)"
    fi
  else
    echo release
  fi
}

skill_slot_mode() {
  local path="$1"
  [ -e "$path" ] || { echo "missing"; return; }
  if [ -L "$path" ]; then
    local target
    target="$(readlink "$path")"
    if [ "$target" = "$DEV_SKILL" ]; then
      echo "dev ($REPO)"
      return
    fi
    case "$target" in
      */skill-packages/sherlog)
        echo "dev-other (${target%/skill-packages/sherlog})"
        return
        ;;
    esac
  fi
  echo release
}

skill_mode() {
  echo "codex=$(skill_slot_mode "$CODEX_SKILL") claude=$(skill_slot_mode "$CLAUDE_SKILL")"
}

cli_to_dev() {
  [ -n "$SHIM" ] || { echo "✗ PATH 中找不到 shlog shim"; return 1; }
  ( cd "$REPO" && npm run build >/dev/null 2>&1 ) || { echo "✗ npm run build 失败"; return 1; }
  # 首次切 dev 前,把原始(发布版)shim 备份一次;已在 dev 时不覆盖备份
  if [ ! -f "$SHIM_BACKUP" ] && [ -z "$(cli_dev_target)" ]; then
    cp "$SHIM" "$SHIM_BACKUP"
  fi
  cat > "$SHIM" <<EOF
#!/bin/sh
# shlog-switch: DEV -> $REPO
exec node "$DEV_CLI" "\$@"
EOF
  chmod +x "$SHIM"
  note "CLI    -> dev      $DEV_CLI"
}

cli_to_release() {
  [ -n "$SHIM" ] || { echo "✗ PATH 中找不到 shlog shim"; return 1; }
  if [ -f "$SHIM_BACKUP" ]; then
    cp "$SHIM_BACKUP" "$SHIM"; chmod +x "$SHIM"
    note "CLI    -> release  (还原 pnpm shim 备份)"
  else
    echo "  备份缺失,改用 pnpm 重装发布版…"
    pnpm add -g @act0r/sherlog >/dev/null 2>&1 || { echo "✗ pnpm add -g @act0r/sherlog 失败"; return 1; }
    note "CLI    -> release  (pnpm 重装 @act0r/sherlog)"
  fi
}

skill_to_dev() {
  if [ -L "$CODEX_SKILL" ]; then
    rm "$CODEX_SKILL"
  elif [ -e "$CODEX_SKILL" ]; then
    if [ -e "$RELEASE_SKILL_BACKUP" ]; then
      echo "✗ release skill 备份已存在: $RELEASE_SKILL_BACKUP;拒绝覆盖 $CODEX_SKILL"
      return 1
    fi
    mv "$CODEX_SKILL" "$RELEASE_SKILL_BACKUP"
  fi
  ln -sfn "$DEV_SKILL" "$CODEX_SKILL"
  mkdir -p "$(dirname "$CLAUDE_SKILL")"
  ln -sfn "$DEV_SKILL" "$CLAUDE_SKILL"
  note "Skill  -> dev      codex:$CODEX_SKILL claude:$CLAUDE_SKILL -> $DEV_SKILL"
}

skill_to_release() {
  if [ -L "$CODEX_SKILL" ]; then
    rm "$CODEX_SKILL"
    if [ -e "$RELEASE_SKILL_BACKUP" ]; then
      mv "$RELEASE_SKILL_BACKUP" "$CODEX_SKILL"
    else
      echo "✗ release skill 备份缺失: $RELEASE_SKILL_BACKUP;请重新运行 npx skills add catoncat/sherlog --full-depth --skill sherlog -g -a codex -y"
      return 1
    fi
  fi
  mkdir -p "$(dirname "$CLAUDE_SKILL")"
  ln -sfn "$CODEX_SKILL" "$CLAUDE_SKILL"
  note "Skill  -> release  codex:$CODEX_SKILL claude:$CLAUDE_SKILL -> $CODEX_SKILL"
}

case "$action" in
  dev)
    [ "$scope" = skill ] || [ "$scope" = skills ] || cli_to_dev
    [ "$scope" = cli ] || skill_to_dev
    ;;
  release)
    [ "$scope" = skill ] || [ "$scope" = skills ] || cli_to_release
    [ "$scope" = cli ] || skill_to_release
    ;;
  status) ;;
  *) usage; exit 2 ;;
esac

echo "── shlog-switch status ──"
echo "CLI:    $(cli_mode)"
echo "Skill:  $(skill_mode)"
echo "target repo: $REPO"
echo "重启已开的 agent / 新开 session 后 skill 改动才完全生效。"
