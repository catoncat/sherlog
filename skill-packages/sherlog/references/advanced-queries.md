# Advanced Queries

## 实际 query 语义

`Sherlog` 不是把用户输入原样透传给 SQLite FTS。当前行为是：

- 先把 query 做 tokenizer 处理
- 每个 term 都会被双引号包住
- term 与 term 之间一律用 `AND`

这意味着：

- 不要指望用户输入里的 `OR`、`NEAR`、`*`、引号按原生 FTS 运算符生效
- 空格分开的多词查询，本质上是“这些词都要进候选”
- 原始整句仍会参与 rerank，所以像 `health check` 这种自然短语仍然值得原样查询

对 agent 的含义：

- 先用自然关键词查询
- 关键词太宽时，增加第二个稳定词，而不是发明 FTS 运算符

## CJK / 中文行为

当前 tokenizer 对 CJK 的策略是：

- 中文/日文/韩文连续串按重叠 bigram 切分
- 单个 CJK 字不会成为有效 FTS term
- 如果 query 含 CJK 但 token 结果为空，会回退到有界 LIKE 扫描

实务建议：

- 单个汉字命中不稳，尽量用至少两字中文词
- 更稳的是“中文短词 + 英文标识符/报错”
- 中文零结果时，先换：
  - 至少两字中文
  - 英文关键词
  - 项目名 / cwd 过滤

## 缩范围：什么时候 `list` 胜过 `find`

优先 `list`：有项目/cwd/日期、弱关键词。时间+关键词见 progressive-workflow Scenario 4。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" list --cwd <repo-cwd> --since <YYYY-MM-DD> --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-range <sessionRef> --query "IME" --json
```

## Read-only SQLite metadata projection

当问题只需要 session metadata projection 时,可以直接只读查询 Sherlog SQLite index。SQLite 是加速投影工具,不是内容证据工具；常规内容仍用 `read-page` / `read-range` 验证。完整 raw 细节走 progressive-workflow 的 raw full-text fallback，不要在 metadata 查询里直接扫 source root。

稳定可查字段只限:

- `session_uuid`
- `source_id`
- `native_session_id`
- `session_key`
- `started_at`
- `ended_at`
- `cwd`
- `title`
- `summary_text`
- `message_count`
- `source_root`
- `file_path`

先拿 db path。这里用 `status` 只取 index 路径,不是把它当通用查询起手:

```bash
DB_PATH="$("${SHLOG_BIN:-${CXS_BIN:-shlog}}" status --json | jq -r '.context.dbPath')"
```

最早 session 候选:

```bash
sqlite3 -readonly "$DB_PATH" \
  "SELECT session_key, started_at, message_count, cwd, title
   FROM sessions
   WHERE message_count > 0
   ORDER BY started_at ASC
   LIMIT 20;"
```

某 cwd 下最近 session 候选（参数化传入目标 cwd，不拼接不可信输入）:

```bash
sqlite3 -readonly "$DB_PATH" \
  "SELECT session_key, ended_at, message_count, title
   FROM sessions
   WHERE cwd = '<repo-cwd>'
   ORDER BY ended_at DESC
   LIMIT 20;"
```

按 cwd 聚合:

```bash
sqlite3 -readonly "$DB_PATH" \
  "SELECT cwd, COUNT(*) AS sessions, SUM(message_count) AS messages, MAX(ended_at) AS latest
   FROM sessions
   GROUP BY cwd
   ORDER BY sessions DESC
   LIMIT 20;"
```

大 session 候选:

```bash
sqlite3 -readonly "$DB_PATH" \
  "SELECT session_key, message_count, started_at, ended_at, cwd, title
   FROM sessions
   ORDER BY message_count DESC
   LIMIT 20;"
```

拿到候选后验证内容:

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-page <sessionRef> --offset 0 --limit 30 --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-range <sessionRef> --query "关键词" --before 4 --after 8 --json
```

metadata projection 只查 Sherlog index。常规内容证据用 `read-*` projection；只有 projection 不够时才进入 raw full-text fallback。

## 同 title 的多变体 session

Codex resume/fork 可能产生多个 title 很像、但 `sessionUuid` 不同的 session。当前 `find` 会保留这些 distinct sessions，不会按 title 折叠。

不要做的事：

- 不要假设 title 一样就是同一场会话
- 不要自己先按 title 去重再看内容

应该做的事：

- 按 `cwd`
- 按 `startedAt` / `endedAt`
- 按 `matchCount`
- 再决定是否继续 `read-range`

## `snippet` 高亮

- FTS path 的 `snippet` 会带 `<mark>...</mark>`
- LIKE fallback 也会自己补 `<mark>...</mark>`
- 如果下游需要纯文本，自己 strip
- 如果你在回答里要引用命中词，高亮保留也可以

## 来源

- 仓库内 `src/query/search.ts`
- 仓库内 `src/query/snippet.ts`
- 仓库内 `src/tokenize.ts`
- 仓库内 `src/ranking.ts`
