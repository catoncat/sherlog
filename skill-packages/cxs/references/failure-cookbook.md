# Failure Cookbook

## 快速表

| 症状 | 先跑 | 处理 |
| --- | --- | --- |
| `find` 零结果但用户坚持存在 | `status --cwd <path> --json` 或 `status --selector '<json>' --json` | 看目标范围的 `requestedCoverage`；必要时 `sync --cwd` / `sync --root` / `sync --selector`；再带同范围查询 |
| `sync` 非零退出带 per-file errors | `sync --root <dir> --json 2>&1` 或 `sync --selector '<json>' --json 2>&1` | 看 `errorDetails[]`；默认严格模式；只在允许部分成功时加 `--best-effort` |
| `sync` 返回 `selector_required` | 原命令补 `--root`、`--cwd` 或 `--selector` | sync 必须显式给范围；不需要把 root 写进 JSON |
| `find/list/stats/read-*` 输出 `index_unavailable` | `status --json` | 索引还没建立；选择范围后 `sync --root` / `sync --cwd` / `sync --selector` |
| raw JSONL 从当前 source snapshot 中消失后担心查不到 | 直接 `find/list/read-*` 查 cxs index | cxs 默认保留已索引历史；不要引导用户改查另一个 root。只有用户明确要丢弃旧历史时才 `sync --prune` |
| `stats/list/find` 报 `database is locked` | 原命令重试一次 | 多半是 SQLite 忙；仍失败就先跳过 `stats` 直接读 |
| 同一主题多条 uuid | `find -n 10 --json` | 按 `startedAt`、`cwd`、`matchCount` 选 |
| 最新/最近 + 关键词被当前会话抢结果 | `find <query> --sort ended --exclude-session <uuid>` | 默认 `find` 是 relevance 排序；时间问题显式用 `--sort ended` 并排除 self-hit |
| metadata-only 问题很慢或结果过宽 | 只读 SQLite 查 cxs index,再 `read-page` 验证候选 | 这是 skill-guidance 问题:agent 把 `status` 或 `find` 用成了通用入口 |
| 中文/CJK 零结果 | 无 | 换至少两字中文、英文关键词，或先用 selector 缩范围 |
| 用户问“最近本项目讨论了什么” | `list --cwd <abs_cwd> --sort ended --json` | 这是 metadata/listing 问题；索引不可用或 coverage 不明时再 `status --cwd` |
| 用户说“在 X 项目里” | `status --json` | 从 `sourceInventory.cwdGroups` 选择 cwd selector |
| 从其他 cwd 调用找不到 db | `stats --json` | 看 `dbPath`；必要时显式传 `--db` |
| `unsupported_source` | 改回省略 `--source` 或 `--source codex` | 当前只有 Codex 是 public source；不要改查 Claude Code raw files |

## Find zero results but user insists it exists

先看 `find --json` / `list --json` 有没有 `nextAction`。有就按它执行；没有也不要直接放弃,先确认目标范围 coverage。

```bash
"${CXS_BIN:-cxs}" status --json
```

如果目标范围没有 fresh coverage，先同步明确范围。cwd/root 用快捷方式，日期窗再用 selector：

```bash
"${CXS_BIN:-cxs}" status --cwd /Users/me/work/foo --json
"${CXS_BIN:-cxs}" sync --cwd /Users/me/work/foo
```

如果 `status --selector` 返回 `recommendedAction: "query"`，跳过 `sync`。

然后查询时继续带同一个 selector。

## Sync non-zero with per-file errors

```bash
"${CXS_BIN:-cxs}" sync --root /Users/me/.codex/sessions --json 2>&1
```

处理规则：

- 默认不要忽略，先看是坏 JSONL、权限问题还是别的解析失败。
- 只有用户明确接受 partial index 时，才用 `--best-effort`。
- `--best-effort` 不写 complete coverage。
- 不要为普通历史查询加 `--prune`；它会删除所选 source 中已经消失的旧 index row。

## index_unavailable

`find` / `read-range` / `read-page` / `list` / `stats` 都读 cxs 自己的 SQLite 索引。第一次安装后还没跑过 `sync --root` / `sync --cwd` / `sync --selector` 时，这些命令会在 `--json` 模式下返回:

```json
{
  "error": {
    "code": "index_unavailable",
    "message": "index not found: ...",
    "dbPath": "...",
    "hint": "Run `cxs sync` first ..."
  }
}
```

处理方式:

```bash
"${CXS_BIN:-cxs}" status --json
"${CXS_BIN:-cxs}" sync --root /Users/me/.codex/sessions
```

没有单独 `init` 命令；`sync --root` / `sync --cwd` / `sync --selector` 会创建并更新索引。

## Database is locked or SQLITE_BUSY

- 先重试原命令一次。
- 如果只是想读取历史，不一定非得先拿 `stats`。
- 如果你刚跑过 `sync` 或怀疑别的进程正占着 db，先等一下再重试。

## Slow or over-broad cxs use

症状:

- 用户只问最早/最新、数量、分布、大 session、某 cwd 下有哪些 session。
- agent 先跑 broad `status`,再跑 broad `find`,花了很久还要人工判断。
- 结果需要的是 session metadata,不是全文相关性。

处理方式:

1. 把它归类为 `skill-guidance-issue`,不是 cxs CLI recall/ranking bug。
2. 对 cxs SQLite index 做只读 metadata projection。
3. 用 `read-page` / `read-range` 验证最终候选的内容。

Example:

```bash
DB_PATH="$("${CXS_BIN:-cxs}" status --json | jq -r '.context.dbPath')"
sqlite3 -readonly "$DB_PATH" \
  "SELECT session_uuid, started_at, message_count, cwd, title
   FROM sessions
   ORDER BY started_at ASC
   LIMIT 20;"
"${CXS_BIN:-cxs}" read-page <sessionUuid> --offset 0 --limit 20 --json
```

不要改查 raw session files;正常历史检索的 projection 也应该来自 cxs index。

## Current project discussion query

用户问“最近本项目讨论了什么”时，这是 metadata/listing primitive。先列当前 repo 最近 session:

```bash
"${CXS_BIN:-cxs}" list --cwd /absolute/path/to/current/repo --sort ended -n 8 --json
```

如果返回 `index_unavailable`,或者用户明确怀疑目标范围没被索引,再诊断 coverage:

```bash
"${CXS_BIN:-cxs}" status --cwd /absolute/path/to/current/repo --json
"${CXS_BIN:-cxs}" sync --cwd /absolute/path/to/current/repo --json
```

然后至少再看：

- `title`
- `summaryText`
- `read-page` 开头 6 到 8 条
- `read-page` 结尾 6 到 8 条

## Recent keyword query

用户问“最新一次 X / 最近哪个 session 提到 X”时:

```bash
"${CXS_BIN:-cxs}" find "X" --cwd /absolute/path/to/current/repo --sort ended --exclude-session <current_session_uuid> --json -n 5
```

不要直接用默认 `find "X"` 下“最新”结论；默认排序是 relevance。只有索引不可用、coverage 不明或结果明显缺失时,再 `status --cwd` / `sync --cwd`。

## --json error shape 速查

不同子命令在 `--json` 下的 error 形状不一致，解析时按命令分流:

| 命令 | error 出口 | 形状 |
| --- | --- | --- |
| `sync` 缺 selector | stdout | `{ "error": { "code": "selector_required", "message": "..." } }` |
| `sync` invalid selector | stdout | `{ "error": { "code": "invalid_selector", "message": "..." } }` |
| `sync` per-file 错 | stderr | `SyncSummary`，看 `errors / errorDetails[]` |
| `sync` 锁超时 | stderr | `{ "error": <message string> }` |
| `status` invalid selector | stdout | `{ "error": { "code": "invalid_selector", "message": "..." } }` |
| `find / read-range / read-page / list / stats` 索引不存在 | stdout | `{ "error": { "code": "index_unavailable", "message": "...", "dbPath": "...", "hint": "..." } }` |
| 任意命令传非公开 source | stdout | `{ "error": { "code": "unsupported_source", "source": "...", "message": "Only \"codex\" is public in this release." } }` |
| `find / read-range / read-page / list / stats` 其他异常 | 进程异常退出 | 直接非零退出 |

## Schema drift

source of truth 永远是：

- 仓库内 `src/types.ts`
- 仓库内 `src/cli.ts`

如果字段、命令、flag 变了：

- 先更新 `references/*.md`
- 再更新 `SKILL.md`
- 最后 bump `skill-sync` 日期

## 来源

- 仓库内 `src/cli.ts`
- 仓库内 `src/types.ts`
- 仓库内 `src/env.ts`
- 仓库内 `src/query.ts`
