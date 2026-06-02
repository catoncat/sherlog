# cxs CLI Surface

命令默认写法：

```bash
"${CXS_BIN:-cxs}" <subcommand> ...
```

如果你没有把 `cxs` 放进 `PATH`，先：

```bash
export CXS_BIN=/absolute/path/to/bin/cxs
```

没有单独的 `init` 命令。`status` 不是每次历史查询的固定第一步；它用于 coverage/freshness/source inventory/index availability。首次安装、索引不可用、目标 selector coverage 不明时,跑 `status --json`，根据返回的 `context.root`、`sourceInventory.cwdGroups` 和问题范围选择 `--cwd` / `--root` / selector；再用 `status --cwd <path> --json` 或 `status --selector '<json>' --json` 检查 coverage。只有 `requestedCoverage.recommendedAction === "sync"` 时才跑对应的 `sync --cwd` / `sync --root` / `sync --selector`。

metadata-only 问题可以直接对 cxs SQLite index 做只读 projection,例如时间排序、数量、cwd 分布；内容判断仍必须回到 `read-page` / `read-range`。

缺少 cxs 索引时,`find` / `read-range` / `read-page` / `list` / `stats --json` 返回:

```json
{ "error": { "code": "index_unavailable", "message": "...", "dbPath": "...", "hint": "..." } }
```

## status

Purpose: 返回执行上下文、source inventory、index 状态和 coverage 状态。`status` 可以扫描 raw session metadata，但不回答内容问题、不写 index,也不是 semantic recall 或 metadata projection 的通用入口。

Example:

```bash
"${CXS_BIN:-cxs}" status --json
"${CXS_BIN:-cxs}" status --cwd /Users/me/work/foo --json
"${CXS_BIN:-cxs}" status --root /Users/me/.codex/sessions --selector '{"kind":"all"}' --json
```

`status --selector` 是只读 coverage check。看 `requestedCoverage`:

- `recommendedAction: "query"`: 目标范围已有 fresh complete coverage，可直接 `find/list`
- `recommendedAction: "sync"`: coverage 缺失或 stale，先跑同范围的 `sync --cwd` / `sync --root` / `sync --selector`
- fresh `{"kind":"all",...}` coverage 可以覆盖 cwd/date 子 selector；`stats.sessionCount` 只是 rows 数，不等于 coverage 完整证明

`root` 不再必须写进 selector JSON：传 `--root <dir>` 可补齐 `selector.root`；不传 `--root` 时使用默认 Codex sessions root。常见 cwd/root 范围优先用 CLI shortcut，日期范围再写 JSON。

Selector shapes:

```json
{"kind":"all","root":"/Users/me/.codex/sessions"}
{"kind":"date_range","root":"/Users/me/.codex/sessions","fromDate":"2026-04-01","toDate":"2026-04-30"}
{"kind":"cwd","root":"/Users/me/.codex/sessions","cwd":"/Users/me/work/foo"}
{"kind":"cwd_date_range","root":"/Users/me/.codex/sessions","cwd":"/Users/me/work/foo","fromDate":"2026-04-01","toDate":"2026-04-30"}
```

## sync

Purpose: 按显式 selector 扫描本地 sessions 并同步到 SQLite 索引。

Options:

| option | 说明 |
| --- | --- |
| `--root <dir>` | 同步整个 sessions 根目录；也作为 selector 默认 root |
| `--cwd <path>` | 同步指定 cwd selector；不必手写 selector JSON |
| `--selector <json>` | 结构化同步范围；日期范围等高级范围用这个 |
| `--db <path>` | 覆盖默认数据库 |
| `--best-effort` | 即使部分文件失败也继续写入成功部分;不写 complete coverage |
| `--prune` | 显式删除所选 source 中已经消失的旧索引记录 |
| `--json` | 成功时把 `SyncSummary` 打到 stdout |

严格模式成功时，`sync` 会更新当前 source snapshot 中仍可见的文件，并写 complete coverage。默认保留已经索引过、但 raw JSONL 后来从 source 中消失的旧 session；查询时不需要切换 root 去追 raw 文件位置。

只有显式传 `--prune` 时，`sync` 才把 selector 范围内的 index 与当前 source snapshot 对齐；源文件已删除的旧 row 会被移除，并计入 `removed`。源文件仍存在但被过滤或不再能解析成 session 时，仍按当前文件状态删除或报错。

Example:

```bash
"${CXS_BIN:-cxs}" sync --cwd /Users/me/work/foo --json
"${CXS_BIN:-cxs}" sync --root /Users/me/.codex/sessions --json 2>&1
"${CXS_BIN:-cxs}" sync --root /Users/me/.codex/sessions --selector '{"kind":"cwd_date_range","cwd":"/Users/me/work/foo","fromDate":"2026-04-15","toDate":"2026-04-30"}' --json
```

## find

Purpose: 搜索相关 session，返回最小必要命中。用于 semantic recall,不是数量/排序/分布这类 metadata projection 的默认工具。

零结果不是结束条件。`--json` 下如果返回 `nextAction`,按它选择/检查同一 selector；text 输出也会打印 `next:` 步骤。只有 `status.requestedCoverage.recommendedAction === "sync"` 时才跑同范围 `sync`,然后重试同一个 `find`。fresh coverage 下仍无结果,才可以说没找到。

Example:

```bash
"${CXS_BIN:-cxs}" find "cf tunnel" --json -n 5
"${CXS_BIN:-cxs}" find "cf tunnel" --cwd /Users/me/work/foo --json -n 5
"${CXS_BIN:-cxs}" find "ping pong" --root /Users/me/.codex/sessions --json -n 5
"${CXS_BIN:-cxs}" find "xsearch" --cwd /Users/me/work/foo --sort ended --exclude-session <current_uuid> --json -n 5
```

Options:

| option | 说明 |
| --- | --- |
| `--root <dir>` | 限定到整个 sessions 根目录；也作为 selector 默认 root |
| `--cwd <path>` | 限定到指定 cwd selector |
| `--selector <json>` | 结构化查询范围；可省略 `root` |
| `--sort relevance|ended|started` | 默认 `relevance`;问"最新/最近 + 关键词"时用 `ended` |
| `--exclude-session <uuid>` | 排除指定 session;可重复。用于排除当前会话/self-hit |
| `-n, --limit <n>` | 返回条数 |

## read-range

Purpose: 围绕命中点读取局部上下文。内容证据优先用它。

Notes:

- 必须显式传 `<sessionUuid>`
- 必须二选一提供 `--seq` 或 `--query`

Example:

```bash
"${CXS_BIN:-cxs}" read-range <sessionUuid> --seq 12 --before 4 --after 8 --json
"${CXS_BIN:-cxs}" read-range <sessionUuid> --query "IME" --before 4 --after 8 --json
```

## read-page

Purpose: 顺序分页读取某个 session 的消息。metadata projection 只能给候选;要确认"当时说了什么/是否有意义",用 `read-page` 或 `read-range`。

Example:

```bash
"${CXS_BIN:-cxs}" read-page <sessionUuid> --offset 0 --limit 40 --json
```

## list

Purpose: 列出已索引 session，不做全文检索。适合简单 session listing；更复杂的 metadata projection 可以用只读 SQLite 查询 cxs index。

Example:

```bash
"${CXS_BIN:-cxs}" list --selector '{"kind":"cwd_date_range","root":"/Users/me/.codex/sessions","cwd":"/Users/me/work/foo","fromDate":"2026-04-15","toDate":"2026-04-30"}' --sort ended --json
"${CXS_BIN:-cxs}" list --root /Users/me/.codex/sessions --sort ended --json
"${CXS_BIN:-cxs}" list --selector '{"kind":"cwd","cwd":"/Users/me/work/foo"}' --sort ended --json
```

## stats

Purpose: 展示索引状态统计。

Example:

```bash
"${CXS_BIN:-cxs}" stats --json
```

## 来源

- 仓库内 `src/cli.ts`
- 仓库内 `src/env.ts`
- 仓库内 `README.md`
