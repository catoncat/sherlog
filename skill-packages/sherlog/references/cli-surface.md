# Sherlog CLI Surface

命令默认写法：

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" <subcommand> ...
```

如果你没有把 `Sherlog` 放进 `PATH`，先：

```bash
export SHLOG_BIN=/absolute/path/to/bin/shlog
```

没有单独的 `init` 命令。普通首次安装可直接跑一次 `sync`，它会初始化默认 Codex root 的 `all` coverage。`status` 不是每次历史查询的固定第一步；它用于 coverage/freshness/source inventory/index availability。目标 selector coverage 不明时,跑 `status --json`，根据返回的 `context.root`、`sourceInventory.cwdGroups` 和问题范围选择 `--cwd` / `--root` / selector；再用 `status --cwd <path> --json` 或 `status --selector '<json>' --json` 检查 coverage。只有 `requestedCoverage.recommendedAction === "sync"` 时才跑对应的 scoped `sync --cwd` / `sync --root` / `sync --selector`。`freshness: "stale"` 但 `staleReason: "source_content_changed"` / `recommendedAction: "query"` 是 Codex 软 stale,常见于当前会话 JSONL 继续追加,不是每次检索前同步的理由。

metadata-only 问题可以直接对 Sherlog SQLite index 做只读 projection,例如时间排序、数量、cwd 分布；内容判断仍必须回到 `read-page` / `read-range`。

支持 source-aware CLI 的版本里,所有固定命令都接受 `--source <id>`。当前公开 source 是 `codex`、experimental `claude-code` 和 experimental `pi`。`find` 省略 `--source` 时默认跨 public sources 搜索，`--source all` 是显式同义写法；`--source codex` / `--source claude-code` / `--source pi` 用于缩小范围或诊断。`status`、`sync`、`list`、`stats` 和裸 `read-*` 省略 source 时仍按 Codex 兼容默认处理；read 命令也可以直接消费 `find` 返回的 `sessionRef`。未知 source 会返回 `unsupported_source`。Claude Code 和 Pi 已是 public CLI 可用 adapter，但仍是 experimental transcript-reader support；不要把它们理解成稳定 raw transcript 格式承诺。如果安装版直接报 unknown option `--source`,它是旧 CLI；省略 source flags 或更新 CLI。

缺少 Sherlog 索引时,`find` / `read-range` / `read-page` / `list` / `stats --json` 返回:

```json
{ "error": { "code": "index_unavailable", "message": "...", "dbPath": "...", "hint": "...", "nextAction": { "kind": "bootstrap_index", "commands": [{ "argv": ["shlog", "sync"], "recommended": true }] } } }
```

已有索引是 source-aware 之前的旧 schema 时,同一批只读命令返回
`index_schema_upgrade_required`。按 hint 跑一次 `sync --source codex --root ...`
或等价 scoped sync；只读命令不会迁移索引。

`read-range` / `read-page` 找不到目标时,`--json` 返回 `session_not_found`。这只说明当前 index
没有该 `sessionRef`,不等于 raw session 不存在。按 `nextAction` 先检查 source/id 和 coverage；
coverage missing/stale 时同步同 source 后重试。

## status

Purpose: 返回执行上下文、source inventory、index 状态和 coverage 状态。`status` 可以扫描 raw session metadata，但不回答内容问题、不写 index,也不是 semantic recall 或 metadata projection 的通用入口。

Example:

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" status --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" status --cwd /Users/me/work/foo --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" status --root /Users/me/.codex/sessions --selector '{"kind":"all"}' --json
```

常用 options: `--source <id>`(public: `codex|claude-code|pi`)、`--root`、`--selector`、`--cwd`、`--db`、`--json`。

`status --selector` 是只读 coverage check。看 `requestedCoverage`:

- `recommendedAction: "query"` + `freshness: "fresh"`: 目标范围已有 fresh complete coverage，可直接 `find/list`
- `recommendedAction: "query"` + `freshness: "stale"` + `staleReason: "source_content_changed"`: 目标 source file 集合没变,只是已有 Codex source file 内容/mtime/size 变了；通常是活跃 session 尾部变化,可先 `find/list`,需要最新尾部或完整审计时再 sync
- `recommendedAction: "sync"`: coverage 缺失或 source file 集合变化，先跑同范围的 `sync --cwd` / `sync --root` / `sync --selector`
- fresh `{"kind":"all",...}` coverage 可以覆盖 cwd/date 子 selector；`stats.sessionCount` 只是 rows 数，不等于 coverage 完整证明

`root` 不再必须写进 selector JSON：传 `--root <dir>` 可补齐 `selector.root`；不传 `--root` 时使用默认 Codex sessions root。常见 cwd/root 范围优先用 CLI shortcut，日期范围再写 JSON。

Selector shapes:

```json
{"source":"codex","kind":"all","root":"/Users/me/.codex/sessions"}
{"source":"codex","kind":"date_range","root":"/Users/me/.codex/sessions","fromDate":"2026-04-01","toDate":"2026-04-30"}
{"source":"codex","kind":"cwd","root":"/Users/me/.codex/sessions","cwd":"/Users/me/work/foo"}
{"source":"codex","kind":"cwd_date_range","root":"/Users/me/.codex/sessions","cwd":"/Users/me/work/foo","fromDate":"2026-04-01","toDate":"2026-04-30"}
```

## sync

Purpose: 按 canonical selector 扫描本地 sessions 并同步到 SQLite 索引。裸 `sync` 是 first-install bootstrap，等价于默认 Codex root 的 `all` selector；日常 agent 范围控制优先用 `--cwd` / `--root` / `--selector`。

Options:

| option | 说明 |
| --- | --- |
| `--source <id>` | 公开值是 `codex`、experimental `claude-code` 和 experimental `pi`;省略等价于 `codex` |
| `--root <dir>` | 同步整个 sessions 根目录；也作为 selector 默认 root |
| `--cwd <path>` | 同步指定 cwd selector；不必手写 selector JSON |
| `--selector <json>` | 结构化同步范围；日期范围等高级范围用这个 |
| `--db <path>` | 覆盖默认数据库 |
| `--best-effort` | 即使部分文件失败也继续写入成功部分;不写 complete coverage |
| `--prune` | 删除 hot snapshot 与已注册/本轮 `--cold-root` 中都不存在的旧索引行；cold-present 保留并计入 `retainedCold` |
| `--cold-root <dir>` | 本轮额外 cold root（可重复）；与 `shlog cold add` 合并，供 `--prune` 识别冷存 |
| `--json` | 成功时把 `SyncSummary` 打到 stdout |

严格模式成功时，`sync` 会更新当前 source snapshot 中仍可见的文件，并写 coverage。Codex JSONL 若在读取后仅继续追加，命令仍成功：coverage 对应已读 byte 边界，并返回 `staleReason: "source_content_changed"`、`recommendedAction: "query"`；其他稳定 source 同时落库，后续 sync 再补活跃尾部。尚未索引的新 Codex 文件若在有界读取前已变化、无法证明前缀安全，本轮会保守延后该文件和 coverage，成功摘要返回 `reason: "active_source_deferred"`、`recommendedAction: "sync"`，其他稳定 source 仍落库。截断、可证明的前缀改写、source file set 变化以及非 Codex source 的同步中变化仍保持严格失败。默认保留已经索引过、但 raw JSONL 后来从 source 中消失的旧 session；查询时不需要切换 root 去追 raw 文件位置。

只有显式传 `--prune` 时，`sync` 才删除 hot 与 cold 都不存在的旧 row，计入 `removed`；仍在 cold root 下的会话保留。源文件仍存在但被过滤或不再能解析成 session 时，仍按当前文件状态删除或报错。

## cold

Purpose: 注册 cold raw 根目录。冷迁/压缩后让 `sync --prune` 把 cold-present 当成保留，而不是 missing。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" cold add --root ~/.codex/archived_sessions --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" cold list --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" cold remove --root ~/.codex/archived_sessions --json
```

配置写在 index 同目录的 `cold-roots.json`。只做 presence（Codex `rollout-*<uuid>.jsonl(.zst)` 文件名），不重解析正文，也不把 cold root 变成默认同步源。

Example:

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" sync --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" sync --cwd /Users/me/work/foo --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" sync --root /Users/me/.codex/sessions --json 2>&1
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" sync --root /Users/me/.codex/sessions --selector '{"kind":"cwd_date_range","cwd":"/Users/me/work/foo","fromDate":"2026-04-15","toDate":"2026-04-30"}' --json
```

## find

Purpose: 搜索相关 session，返回最小必要命中。用于 semantic recall,不是数量/排序/分布这类 metadata projection 的默认工具。

`find` 默认搜索所有 public indexed sources。结果里的 `sourceId` 告诉你来源，`sessionRef` 是后续 `read-range` / `read-page` 的首选输入。只有用户指定来源、要缩小范围、或在诊断某个 source 的覆盖问题时才加 `--source codex` / `--source claude-code` / `--source pi`。

text header 带效率回述:`shlog find "q" · 检索 ~N 条 · 结果 R · Xms`(`检索 ~N` = 范围内语料规模诚实分母,`--json` 里是 `scannedMessageCount` / `elapsedMs`)。`read-range` / `read-page` 的 header 带「读取 K 条 / 本 session 共 T 条 · Xms」和 `total=… · hasMore=… · Xms`。大规模调查时可用这些真实数字做一句简短尾注,**不要据此编造「省 X%」**。

`find --json` 的每个结果会带 `evidenceRead`，优先执行里面的 `argv` 去读取内容证据。message-level 命中通常是 `read-range --seq ... --query ...`，这样后续超大消息省略时仍能围绕 query term 保留证据 span；session-level 命中可能是 `read-range --query ...` 或 fallback `read-page`。

效率回述默认开,环境变量 `SHLOG_STATS=0`(或 `off`/`false`/`no`)可关闭文本 header 里的注解(`检索 ~N 条 / 读取 K 条 / Xms`);`--json` 的 `scannedMessageCount` / `elapsedMs` 与 `read-page` 的 `total/hasMore` 等功能字段始终保留。关闭时文本里没有可锚的数字,直接省掉效率尾注、别硬编。

零结果不是结束条件。`find --json` 会在同一次调用中评估 raw source freshness，因此 `coverage.complete` / `freshness` / `staleReason` 与 `nextAction` 使用同一 snapshot；纯 SQLite query facade 无法检查 raw 时则诚实返回 `complete=false` / `freshness=not_checked`，但保留 `coveringSelectors`。`--json` 下如果返回 `nextAction`,按它选择/检查同一 selector；text 输出也会打印 `next:` 步骤。Codex `find` 对非空结果会忽略 `source_content_changed` 软 stale,避免当前会话尾部变化反复逼 agent 同步；此时 `complete=false` 表示最新尾部未获证明，不表示已有索引不可查询。若非空结果仍返回 `nextAction.reason=stale_or_missing_coverage`,通常是 coverage 缺失、source file 集合变化或非 Codex source 保守同步；需要完整结论时按 `nextAction.commands` 同步并重试。fresh coverage 下仍无结果,才可以说没找到。

Example:

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" find "cf tunnel" --json -n 5
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" find "cf tunnel" --cwd /Users/me/work/foo --json -n 5
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" find "ping pong" --root /Users/me/.codex/sessions --json -n 5
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" find "xsearch" --cwd /Users/me/work/foo --sort ended --exclude-session <current_uuid> --json -n 5
```

Options:

| option | 说明 |
| --- | --- |
| `--source <id>` | 公开值是 `codex`、experimental `claude-code`、experimental `pi` 或 `all`;省略等价于 `all` |
| `--root <dir>` | 限定到整个 sessions 根目录；也作为 selector 默认 root |
| `--cwd <path>` | 限定到指定 cwd selector |
| `--selector <json>` | 结构化查询范围；可省略 `root` |
| `--sort relevance|ended|started` | 默认 `relevance`;问"最新/最近 + 关键词"时用 `ended` |
| `--exclude-session <uuid>` | 排除指定 session;可重复。用于排除当前会话/self-hit |
| `-n, --limit <n>` | 返回条数 |

## read-range

Purpose: 围绕命中点读取局部上下文。内容证据优先用它。

Notes:

- 必须显式传 `<sessionUuid>` 或 `find` 返回的 `<sessionRef>`
- 必须二选一提供 `--seq` 或 `--query`
- 默认会确定性省略超大单条消息；`--max-message-chars <n>` 控制单条消息保留预算，`0` 表示不省略。JSON 会在被省略的 message 上返回 `elision` metadata。
- 可选 `--source codex|claude-code|pi`;省略等价于 Codex。`<source>:<uuid>` qualifier 会直接决定读取 source；若同时传 `--source`,两者必须匹配。

Example:

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-range <sessionUuid> --seq 12 --before 4 --after 8 --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-range <sessionUuid> --query "IME" --before 4 --after 8 --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-range <sessionUuid> --seq 12 --query "exact clue" --max-message-chars 2000 --json
```

## read-page

Purpose: 顺序分页读取某个 session 的消息。metadata projection 只能给候选;要确认"当时说了什么/是否有意义",用 `read-page` 或 `read-range`。

默认会确定性省略超大单条消息；`--max-message-chars <n>` 控制单条消息保留预算，`0` 表示不省略。JSON 会在被省略的 message 上返回 `elision` metadata。

可选 `--source codex|claude-code|pi`;省略等价于 Codex。
如果传入 `claude-code:<uuid>` 或 `pi:<uuid>` 这类 `sessionRef`,无需再传对应 `--source`。

Example:

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-page <sessionUuid> --offset 0 --limit 40 --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-page <sessionUuid> --offset 0 --limit 40 --max-message-chars 2000 --json
```

## list

Purpose: 列出已索引 session，不做全文检索。适合简单 session listing；更复杂的 metadata projection 可以用只读 SQLite 查询 Sherlog index。

常用 options: `--source <id>`(public: `codex|claude-code|pi`)、`--cwd`、`--since`、`--root`、`--selector`、`--sort ended|started|messages`、`-n/--limit`、`--db`、`--json`。

Example:

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" list --selector '{"kind":"cwd_date_range","root":"/Users/me/.codex/sessions","cwd":"/Users/me/work/foo","fromDate":"2026-04-15","toDate":"2026-04-30"}' --sort ended --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" list --root /Users/me/.codex/sessions --sort ended --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" list --selector '{"kind":"cwd","cwd":"/Users/me/work/foo"}' --sort ended --json
```

## stats

Purpose: 展示索引状态统计。

可选 `--source codex|claude-code|pi`;省略等价于 Codex。

Example:

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" stats --json
```

## 来源

- 仓库内 `src/cli.ts`
- 仓库内 `src/env.ts`
- 仓库内 `README.md`
- 仓库内 `docs/ARCHITECTURE.md`
