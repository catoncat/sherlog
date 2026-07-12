# Sherlog 当前架构

## 一句话

`Sherlog` 是一个面向本机 agent session 日志的渐进式检索 CLI，当前架构是：

`status -> sync --root/--cwd/--selector -> message/session recall -> session heuristic rerank -> read-range/read-page`

它已经可用，但仍是轻量 retrieval 后端，不是完整的 resource-level retrieval 系统。当前公开 session source 有 `codex`、experimental `claude-code` 和 experimental `pi`；其中 `claude-code` 与 `pi` 已接到固定 CLI 命令面，但仍应视作 experimental transcript-reader support，而不是稳定 raw-format 承诺。

## 当前命令面

- `shlog sync`
- `shlog status`
- `shlog find <query>`
- `shlog read-range <sessionUuid>`
- `shlog read-page <sessionUuid>`
- `shlog list`
- `shlog stats`

这套命令面已经定型，不再保留 `window/session` 旧别名语义。

这些命令都接受可省略的 `--source <id>`。当前公开值是 `codex`、experimental `claude-code` 和 experimental `pi`。`find` 是召回入口，省略 `--source` 时默认跨所有 public source 搜索；`--source codex` / `--source claude-code` / `--source pi` 用于窄化或诊断。`status`、`sync`、`list`、`stats` 和裸 `read-*` 仍以 Codex 作为省略 source 的兼容默认。传入未知 source 会返回 `unsupported_source`，不会开始扫描、查询或读取。

## 数据流

### 0. Source adapter

`src/sources/` 定义 source adapter 边界和 registry。当前 registry 公开 Codex adapter、experimental Claude Code adapter 和 experimental Pi adapter：

- `codex` adapter 负责默认 root、Codex JSONL inventory/snapshot、Codex parser。
- `claude-code` adapter 负责默认 root、Claude Code transcript inventory/snapshot、Claude parser，并通过 public fixed-command surface 接入 source-aware indexing / read isolation。
- `pi` adapter 负责默认 root、Pi transcript inventory/snapshot、Pi parser，并通过 public fixed-command surface 接入 source-aware indexing / read isolation。
- 核心层负责 selector、coverage、DB、query/read/list/stats。
- `find` 默认跨 public source fanout 并合并结果；切换 `--source claude-code` 或 `--source pi` 时走同一组命令但只查目标 source。当前非 Codex 语义仍限于 allowlisted transcript text。

Accepted/rejected projection boundaries live in [SOURCE_CONTRACTS.md](SOURCE_CONTRACTS.md). Treat that file as the code-facing contract for parser privacy fixtures; it is not an upstream raw-format stability promise.

Codex adapter 会把原有 `sessionUuid` 映射为 source-aware identity：

- `sourceId = "codex"`
- `nativeSessionId = sessionUuid`
- `sessionKey = "codex:" + sessionUuid`

公共 read/find/list 输出继续保留 `sessionUuid`，以兼容旧 Codex UUID 工作流。

### 1. 同步

[status.ts](/Users/envvar/work/repos/cxs/src/status.ts) 返回执行上下文、source inventory、index 状态与 coverage 状态。它可以扫描 raw sessions 的 metadata，但不回答内容问题。

[indexer.ts](/Users/envvar/work/repos/cxs/src/indexer.ts) 按显式 selector 扫描选定 source 的 session snapshot。当前公开 source 可以是 Codex、Claude Code 或 Pi；增量判断仍基于文件 `mtime`、`size` 和 `indexVersion`。

strict sync 默认只更新当前 source snapshot 中仍可见的文件，并保留已经进入 SQLite 的旧 session。Codex adapter 的读取固定在本轮捕获的 byte 边界；若相同 file set 中某个活跃 JSONL 在读后只追加，indexer 校验已读前缀摘要与既有投影后允许提交起始边界，并把 coverage 标为 `source_content_changed` soft stale。尚未索引的新文件若在 parser 打开前已变化，无法证明 snapshot 前缀安全，indexer 会延后该文件和 complete coverage（`active_source_deferred`），但在同一事务提交其他稳定 operation。截断、可证明的前缀改写/替换、file set 变化和其他 source 的中途变化仍阻断事务。这样既不会因当前对话增长阻塞稳定 source，也不会把未读或未证明的尾部发布成 fresh coverage。只有显式传 `--prune` 时，sync 才会把 selector 范围收敛成当前 source snapshot，并删除同一 source 中已不存在的旧 index row。一个 source 的 sync/prune 不会删除另一个 source 的数据。当前 source 中仍存在但被过滤或不能解析成 session 的文件仍按当前状态处理。

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

CLI 默认 `find` 会对 public sources 执行单源 `findSessions()` fanout，再用 reciprocal-rank fusion 合并候选，避免直接比较不同 source 子集里的 raw FTS 分数。JSON 结果带 `sourceId` 和 `sessionRef`；`sessionRef` 可直接传给 `read-range` / `read-page`，所以 agent 不需要再推断来源。

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
- source adapter boundary and public `--source codex|claude-code|pi`
- source-aware selector / coverage / DB identity / query-read isolation
- default cross-source `find` over public sources
- strict / best-effort 两种 sync 语义
- explicit sync scope (`--root` / `--cwd` / `--selector`, canonicalized to selector)
- source inventory
- complete coverage 记录
- manual eval 导出
- eval batch compare
- experimental public Claude Code fixed-command support
- experimental public Pi fixed-command support

## 当前未落地能力

下面这些不要误写成现状：

- query-profile 分类驱动的 ranking 分权（真实 A/B 未证明有效，当前已删除该内部抽象）
- richer projection / event replay / range cache
- duplicate collapse / diversity control
- 强约束 gold set / rubric / error taxonomy
- watcher / daemon / realtime sync
- Claude Code / Pi raw JSONL stable public format decision；当前 experimental transcript readers 不等同于稳定格式承诺

## 为什么当前文档改成这版

之前的 tracking/research 文档混合了三种内容：

- 当前实现
- 目标态建议
- 外部调研结论

这种写法会误导后续 agent 把“建议”当成“现状”。这里保留的只有当前代码真相；后续计划单独放到 [docs/ROADMAP.md](/Users/envvar/work/repos/cxs/docs/ROADMAP.md)。
