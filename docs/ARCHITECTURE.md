# cxs 当前架构

## 一句话

`cxs` 是一个面向本机 Codex session 日志的渐进式检索 CLI，当前架构是：

`status -> sync --root/--cwd/--selector -> message/session recall -> session heuristic rerank -> read-range/read-page`

它已经可用，但仍是轻量 retrieval 后端，不是完整的 resource-level retrieval 系统。当前公开 session source 有 `codex` 和 experimental `claude-code`；其中 `claude-code` 已接到固定 CLI 命令面，但仍应视作 experimental transcript-reader support，而不是稳定 raw-format 承诺。

## 当前命令面

- `cxs sync`
- `cxs status`
- `cxs find <query>`
- `cxs read-range <sessionUuid>`
- `cxs read-page <sessionUuid>`
- `cxs list`
- `cxs stats`

这套命令面已经定型，不再保留 `window/session` 旧别名语义。

这些命令都接受可省略的 `--source <id>`。当前公开值是 `codex` 和 experimental `claude-code`，省略时等价于 `--source codex`。传入未知 source 会返回 `unsupported_source`，不会开始扫描、查询或读取。

## 数据流

### 0. Source adapter

`src/sources/` 定义 source adapter 边界和 registry。当前 registry 公开 Codex adapter 和 experimental Claude Code adapter：

- `codex` adapter 负责默认 root、Codex JSONL inventory/snapshot、Codex parser。
- `claude-code` adapter 负责默认 root、Claude Code transcript inventory/snapshot、Claude parser，并通过 public fixed-command surface 接入 source-aware indexing / read isolation。
- 核心层负责 selector、coverage、DB、query/read/list/stats。
- 公开命令面默认仍是 `codex` source；切换 `--source claude-code` 时走同一组命令，但当前语义仍限于 allowlisted transcript text。

Codex adapter 会把原有 `sessionUuid` 映射为 source-aware identity：

- `sourceId = "codex"`
- `nativeSessionId = sessionUuid`
- `sessionKey = "codex:" + sessionUuid`

公共 read/find/list 输出继续保留 `sessionUuid`，以兼容旧 Codex UUID 工作流。

### 1. 同步

[status.ts](/Users/envvar/work/repos/cxs/src/status.ts) 返回执行上下文、source inventory、index 状态与 coverage 状态。它可以扫描 raw sessions 的 metadata，但不回答内容问题。

[indexer.ts](/Users/envvar/work/repos/cxs/src/indexer.ts) 按显式 selector 扫描选定 source 的 session snapshot。当前公开 source 可以是 Codex 或 Claude Code；增量判断仍基于文件 `mtime`、`size` 和 `indexVersion`。

strict sync 默认只更新当前 source snapshot 中仍可见的文件，并保留已经进入 SQLite 的旧 session。这样 raw JSONL 的维护、移动或删除不会让 cxs 的历史查询丢失。只有显式传 `--prune` 时，sync 才会把 selector 范围收敛成当前 source snapshot，并删除同一 source 中已不存在的旧 index row。一个 source 的 sync/prune 不会删除另一个 source 的数据。当前 source 中仍存在但被过滤或不能解析成 session 的文件仍按当前状态处理。

[parser.ts](/Users/envvar/work/repos/cxs/src/parser.ts) 只抽取 `event_msg` 里的：

- `user_message`
- `agent_message`

同时过滤内部 marker，避免污染索引。

### 2. 持久化

[db.ts](/Users/envvar/work/repos/cxs/src/db.ts) 是 SQLite 访问 facade；`src/db/` 下的 schema / store / coverage 模块维护两层主数据：

- `sessions`
- `messages`
- `coverage`

`sessions` 当前使用 source-aware identity：`source_id`、`native_session_id`、`session_key`。旧 Codex row 会回填为 `source_id = "codex"`、`native_session_id = session_uuid`、`session_key = "codex:" || session_uuid`。`sessions.source_root` 持久化该 session 被同步时使用的 selector root，read-range / read-page 的 coverage attribution 基于这个字段，而不是从文件路径命名约定反推。

`coverage` 同样存储 `source_id`，并且 canonical selector JSON 包含 `source`。fresh `all(root)` coverage 只覆盖同一个 source 下的更窄 selector。

以及两个全文索引：

- `messages_fts`
- `sessions_fts`

`messages_fts` 只索引真实消息，`sessions_fts` 索引 `title + summary_text + compact_text + reasoning_summary_text`。这样可以让生成标题、派生摘要、compact handoff、reasoning summary 参与召回，同时不把这些 session-level 信号伪装成 `seq = -1` 的消息。

SQLite 访问层当前已经按 reader / writer 分流：

- `sync` 走 writer 连接，负责 schema ensure、WAL 初始化与写入事务
- `find` / `read-range` / `read-page` / `list` / `stats` 走只读连接
- `status` 不写 index；它可以读取 raw metadata 和只读 SQLite
- 读路径默认设置 `busy_timeout`，避免并发 agent 多查时把瞬时锁竞争直接暴露成 `SQLITE_BUSY`
- `sync` 额外有文件级 single-writer lock；遇到活跃 writer 会等待，遇到 dead pid 残留锁会自动清理

### 3. 查询

[query.ts](/Users/envvar/work/repos/cxs/src/query.ts) 是查询 facade；`src/query/` 下的 find / read / list / stats / search 模块提供三类读取：

- `findSessions()`
- `getMessageRange()`
- `getMessagePage()`

`findSessions()` 当前流程是：

1. 从 `messages_fts` 做原文证据召回
2. 从 `sessions_fts` 做 session-level 字段召回
3. 极少数零 token CJK query 在 message 侧回退到 LIKE
4. 把 raw hits 合并后交给 [ranking.ts](/Users/envvar/work/repos/cxs/src/ranking.ts) 做 session 级排序

`messages` 仍然只代表可回读的真实 transcript。session-level 命中会以 `matchSource = "session"` 返回；如果没有真实 message anchor，`matchSeq` 为 `null`，CLI 会建议先 `read-page`。

### 4. 排序

[ranking.ts](/Users/envvar/work/repos/cxs/src/ranking.ts) 当前是 heuristic rerank，不是独立的 resource-level reranker。

主要信号包括：

- row 级 bm25 翻转分数
- session-level FTS 字段权重：title 8.0、compact 4.0、summary 3.0、reasoning summary 1.2
- content phrase / term coverage
- user message bump
- title phrase / term hits
- cwd term hits
- user hit count
- session-level hit count
- hit count
- recency

## 当前已落地能力

- 渐进式命令面
- CJK 兼容的 tokenized FTS
- `summary_text` 派生摘要
- `compact_text` 解析 JSONL `type=compacted` handoff
- `reasoning_summary_text` 解析 `response_item.reasoning.summary`
- `sessions_fts(title + summary_text + compact_text + reasoning_summary_text)` session-level recall
- source adapter boundary and public `--source codex`
- source-aware selector / coverage / DB identity / query-read isolation
- strict / best-effort 两种 sync 语义
- explicit sync scope (`--root` / `--cwd` / `--selector`, canonicalized to selector)
- source inventory
- complete coverage 记录
- manual eval 导出
- eval batch compare
- private / non-public Claude Code adapter synthetic path（不是 public CLI source）

## 当前未落地能力

下面这些不要误写成现状：

- 真正按 broad/exact query profile 分权的 scoring
- richer projection / event replay / range cache
- duplicate collapse / diversity control
- 强约束 gold set / rubric / error taxonomy
- watcher / daemon / realtime sync
- 公开 Claude Code adapter / `cxs sync --source claude-code`
- Claude Code raw JSONL public format decision；private adapter 目前不等同于稳定公开格式承诺

## 为什么当前文档改成这版

之前的 tracking/research 文档混合了三种内容：

- 当前实现
- 目标态建议
- 外部调研结论

这种写法会误导后续 agent 把“建议”当成“现状”。这里保留的只有当前代码真相；后续计划单独放到 [docs/ROADMAP.md](/Users/envvar/work/repos/cxs/docs/ROADMAP.md)。
