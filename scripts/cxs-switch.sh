#!/usr/bin/env bash
# cxs-switch — 在「项目最新版(dev)」与「发布版(release)」之间切换 cxs 的 CLI 与 Skill。
#
# 背景:
#   - 全局 `cxs` 是 pnpm 装的发布版 @act0r/cxs;dev 时把 PATH 里的 shim 改成
#     exec 本 repo 的 dist/cli.js(首次切 dev 前会备份原始 shim,release 时还原)。
#   - skill `~/.claude/skills/cxs` 是个 symlink;dev/release 只是把它重定向到
#     repo 的 skill-packages/cxs 或发布版目录 ~/.agents/skills/cxs,不复制文件。
#
# 用法:
#   scripts/cxs-switch.sh dev        # CLI + Skill 都切到 repo 最新(会先 npm run build)
#   scripts/cxs-switch.sh release    # CLI + Skill 都切回发布版
#   scripts/cxs-switch.sh status     # 查看当前各自处于哪个版本
#   第二参数可限定范围: ... dev cli  /  ... release skills
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$HOME/.cxs-switch"
mkdir -p "$STATE_DIR"

# ---- CLI ----
SHIM="$(command -v cxs || true)"
DEV_CLI="$REPO/dist/cli.js"
SHIM_BACKUP="$STATE_DIR/cxs.release-shim"

# ---- Skill ----
ACTIVE_LINK="$HOME/.claude/skills/cxs"
DEV_SKILL="$REPO/skill-packages/cxs"
RELEASE_SKILL="$HOME/.agents/skills/cxs"

note() { printf '  %s\n' "$*"; }

cli_mode() {
  [ -n "$SHIM" ] || { echo "missing"; return; }
  if grep -q "$DEV_CLI" "$SHIM" 2>/dev/null; then echo dev; else echo release; fi
}

skill_mode() {
  [ -L "$ACTIVE_LINK" ] || { echo "not-a-symlink"; return; }
  [ "$(readlink "$ACTIVE_LINK")" = "$DEV_SKILL" ] && echo dev || echo release
}

cli_to_dev() {
  ( cd "$REPO" && npm run build >/dev/null 2>&1 ) || { echo "✗ npm run build 失败"; return 1; }
  # 首次切 dev 前,把原始(发布版)shim 备份一次;已在 dev 时不覆盖备份
  if [ ! -f "$SHIM_BACKUP" ] && ! grep -q "$DEV_CLI" "$SHIM" 2>/dev/null; then
    cp "$SHIM" "$SHIM_BACKUP"
  fi
  cat > "$SHIM" <<EOF
#!/bin/sh
# cxs-switch: DEV -> $REPO
exec node "$DEV_CLI" "\$@"
EOF
  chmod +x "$SHIM"
  note "CLI    -> dev      $DEV_CLI"
}

cli_to_release() {
  if [ -f "$SHIM_BACKUP" ]; then
    cp "$SHIM_BACKUP" "$SHIM"; chmod +x "$SHIM"
    note "CLI    -> release  (还原 pnpm shim 备份)"
  else
    echo "  备份缺失,改用 pnpm 重装发布版…"
    pnpm add -g @act0r/cxs >/dev/null 2>&1 || { echo "✗ pnpm add -g @act0r/cxs 失败"; return 1; }
    note "CLI    -> release  (pnpm 重装 @act0r/cxs)"
  fi
}

skill_to_dev() {
  [ -L "$ACTIVE_LINK" ] || { echo "✗ $ACTIVE_LINK 不是 symlink,拒绝覆盖"; return 1; }
  ln -sfn "$DEV_SKILL" "$ACTIVE_LINK"
  note "Skill  -> dev      $DEV_SKILL"
}

skill_to_release() {
  [ -L "$ACTIVE_LINK" ] || { echo "✗ $ACTIVE_LINK 不是 symlink,拒绝覆盖"; return 1; }
  ln -sfn "$RELEASE_SKILL" "$ACTIVE_LINK"
  note "Skill  -> release  $RELEASE_SKILL"
}

scope="${2:-both}"
case "${1:-status}" in
  dev)
    [ "$scope" = skills ] || cli_to_dev
    [ "$scope" = cli ] || skill_to_dev
    ;;
  release)
    [ "$scope" = skills ] || cli_to_release
    [ "$scope" = cli ] || skill_to_release
    ;;
  status) ;;
  *) echo "用法: cxs-switch {dev|release|status} [cli|skills]"; exit 2 ;;
esac

echo "── cxs-switch status ──"
echo "CLI:    $(cli_mode)"
echo "Skill:  $(skill_mode)"
echo "repo:   $REPO"
echo "重启已开的 agent / 新开 session 后 skill 改动才完全生效。"
