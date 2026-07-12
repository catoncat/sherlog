# Sherlog Index Coverage Design

## 目标

Sherlog 是面向 agent 的本地 session retrieval backend。当前公开 source 有
`codex` 和 experimental `claude-code`。`find` 默认跨 public sources 召回；
其他 source-scoped 命令省略 source 时仍以 Codex 作为兼容默认。

目标态：

- 内容回答只来自 Sherlog index。
- 原始 sessions 只用于盘点资源与制定同步计划。
- 同步范围必须结构化、可验证；裸 `sync` 只能作为 first-install bootstrap shorthand，并必须还原为 canonical selector。
- 查询结果必须能够声明 index 覆盖边界。
- 首次安装后，agent 可以通过有限同步快速进入可用状态。

## 设计原则

### 单一回答真相

Sherlog index 是唯一可用于回答内容问题的真相源。

原始 sessions 只能用于：

- 盘点可同步资源
- 推断可选同步范围
- 生成同步计划

原始 sessions 不能直接参与 `find`、`list`、`read-range`、`read-page` 的结果生成。

### 显式同步

`sync` 是唯一写入口。裸 `sync` 是 first-install bootstrap shorthand，进入 index/coverage 流程前必须 canonicalize 为默认 source/root 的 `all` selector。

只读命令不得隐式触发同步。

只读命令不得修改 index。

内容读取命令不得扫描原始 sessions。

### 结构化状态优先

CLI 面向 agent 输出 facts，不输出解释性标签。

禁止使用需要自然语言解释的 shortcut selector 或 shortcut status。CLI 可以提供确定性的 `--cwd` / `--root` shorthand，但它们必须在进入 coverage/index 流程前还原为明确 selector。

所有状态必须能还原为明确 selector。

### Coverage First

index 不只记录已有数据，还要记录数据覆盖范围。

`lastSyncAt` 不是覆盖证明。

`earliestStartedAt` / `latestEndedAt` 不是覆盖证明。

coverage 才是覆盖证明。

coverage 必须表达：

- source
- sessions root
- selector
- 完整性状态
- 扫描文件数
- 成功索引数
- 完成时间
- index version

### 渐进式可用

Sherlog 不要求首次使用前完成 full sync。

agent 应基于 source inventory 和 index coverage，选择最小充分同步范围。

系统允许局部回答，但局部回答必须携带覆盖边界。

## 核心概念

### Source Inventory

Source inventory 是对某个 session source 原始文件的轻量盘点。

它回答：

- 当前 source 是什么
- 原始 session 文件有多少
- 文件路径日期范围是什么
- 存在哪些 cwd
- 某个 cwd 对应哪些日期范围

Source inventory 不回答：

- 某个主题是否出现过
- 某个 session 的具体内容是什么
- 某个历史结论是否成立

### Index

Index 是 Sherlog 的检索数据库。

它回答：

- 哪些 session 已可检索
- 哪些 message 已可读取
- 哪些 session-level 字段已参与召回
- 哪些范围已完成同步

### Selector

Selector 是同步范围的结构化描述。

允许的基础维度：

- source
- sessions root
- cwd
- date range

目标态 selector：

```text
all(source, root)
date_range(source, root, fromDate, toDate)
cwd(source, root, cwd)
cwd_date_range(source, root, cwd, fromDate, toDate)
```

selector 是 agent 和 CLI 之间的同步契约。

省略 source 的 selector 输入只能在 CLI 边界 canonicalize。单源命令会补成
当前命令的 source；默认跨源 `find` 会对每个 public source 建立对应 selector。
进入 coverage、index、query、read 流程后，selector 必须带 canonical source。

### Coverage

Coverage 是 index 对 selector 的完成记录。

只有完整成功的同步才能产生 complete coverage。

部分成功不能记录为 complete coverage。

Coverage 绑定 source、selector 和 source snapshot。

当 raw sessions 中属于该 selector 的文件集合、文件大小、mtime、cwd metadata 或 index version 改变时，既有 complete coverage 对当前 source snapshot 不再 fresh。

Freshness 只能由 planning command 扫描 raw sessions 后判断。

内容读取命令只能报告 index 中已有 coverage，不得为了判断 freshness 扫描 raw sessions。

### Coverage Implication

Coverage 可以蕴含更窄 selector。

规则：

- source 不同的 selector 永远不能互相蕴含
- `all(root)` 蕴含同 root 下任意 selector
- `date_range(root, from, to)` 蕴含同 root 下被完全包含的 date range selector
- `cwd(root, cwd)` 蕴含同 root、同 cwd 下任意 date range selector
- `cwd_date_range(root, cwd, from, to)` 只蕴含同 root、同 cwd、且日期范围被完全包含的 selector

上面所有同 root / 同 cwd / 日期范围判断都以同 source 为前提。fresh
`all(codex, root)` 只能覆盖同一个 source/root 下更窄 selector，不能覆盖未来
其他 source 的 selector。

## 命令职责

### status

`status` 是 planning command，不属于内容读取命令。

职责：

- 返回当前执行上下文
- 返回 source inventory
- 返回 index 状态
- 返回 coverage 状态
- 当传入 `--selector` 时，返回该 selector 的 `requestedCoverage`、freshness 与 recommendedAction

约束：

- 不写 index
- 不回答内容问题
- 不读取 Codex state DB
- 不执行 sync
- 可扫描 raw sessions 的 metadata
- 不读取 raw message content
- `status --selector` 是 coverage check，不是隐式 sync

### sync

`sync` 是唯一写入口。

职责：

- 根据 selector 扫描 raw sessions
- 更新 index
- 写入 coverage
- 输出同步结果

约束：

- 同步范围必须可还原为 selector；裸 `sync`、`--cwd`、`--root` 都只是确定性 shorthand，进入实现前必须 canonicalize 成 selector
- 无 selector/scope 的裸 `sync` 只表示 first-install bootstrap：默认 source/root 下的 `all` selector；不得扩展为 `find/list/read-*` 的隐式同步语义
- 严格成功才写 complete coverage
- strict sync 默认保留 selector 范围内已索引、但当前 source snapshot 中已消失的旧 row；raw JSONL 的维护、移动或删除不应让 Sherlog 历史查询丢失
- `--prune` 才把 selector 范围内的 index 收敛成当前 source snapshot 的投影，并删除 source 中已不存在的旧 row
- source 中仍存在但被过滤或已不再可解析成 session 的当前文件，仍应从 index 中删除或报错
- best-effort 不能产生 complete coverage

### find

`find` 是内容召回命令。

职责：

- 从 index 中召回相关 session
- 返回可继续读取的锚点或 session-level 命中
- 返回当前 index coverage 摘要
- 默认按 relevance 排序；显式 `--sort ended|started` 才表示时间排序

约束：

- 只允许为 coverage freshness 做 metadata-only raw session 扫描；内容召回本身仍只读 SQLite index
- 不触发 sync
- 不使用 source inventory 作为召回来源
- coverage missing 或 source file 集合变化时即使已有结果也必须返回 `nextAction`，避免 agent 把旧索引结果当完整历史结论
- coverage 仅因既有 source file 内容变化而 stale 时归类为 `source_content_changed`；该判断必须基于 source file set fingerprint / path set，而不是 file count。Codex 当前会话 JSONL 尾部追加可把它降级为 `recommendedAction: "query"` 的软 stale，非空 `find` 不应强制 agent 每次同步。其他 source 仍可保守推荐 `sync`。
- strict sync 读取 Codex 文件时固定本轮 byte 边界。相同 file set 中经前缀摘要与既有索引投影证明的纯追加可以提交该边界，并在成功摘要中返回 `coverage.staleReason: "source_content_changed"` / `recommendedAction: "query"`；未读尾部不进入本轮 coverage。截断、前缀改写、替换、file set 变化和非 Codex 中途变化仍失败。

### list

`list` 是 index metadata 查询命令。

职责：

- 基于 index 列出 session
- 支持 cwd / time 等过滤
- 返回当前 index coverage 摘要

约束：

- 不扫描 raw sessions
- 不触发 sync

### read-range / read-page

读取命令只读取 index 中已存在 session。

职责：

- 返回可回读 transcript
- 保持 message stream 语义纯净

约束：

- 不读取 raw JSONL
- 不触发 sync
- 不合成虚拟 message

## Agent 工作模型

agent 使用 Sherlog 的标准流程：

```text
status
select sync scope (canonical selector)
sync
find or list
read-range or read-page
answer with coverage boundary
```

agent 不应直接假设 index 完整。

agent 不应把 partial coverage 当作 full history。

agent 不应在未声明覆盖范围时回答全历史问题。

`current` 不是目标命令。

不得通过 Codex state DB 或其他外部 session registry 获取内容候选。

## 查询语义

### 当前项目问题

当前项目问题应优先使用 cwd selector。

如果 source inventory 显示当前 cwd 有 raw sessions，agent 应同步该 cwd 对应范围，再查询 index。

### 主题历史问题

主题历史问题应基于已有 coverage 判断可回答范围。

如果 coverage 不足，agent 可以选择扩大 selector。

回答必须区分：

- 已覆盖范围内未发现
- 全历史未发现

### 全历史问题

全历史问题需要 full coverage 才能给出完整结论。

未完成 full coverage 时，只能回答已覆盖 selector 内的发现结果，并声明覆盖范围。

## 非目标

v1 不做：

- watcher
- daemon
- realtime sync
- 隐式 sync
- Codex state DB fallback
- 自然语言 selector
- human-friendly shortcut labels
- raw sessions 直接检索
- GUI-specific behavior

## 文档要求

设计文档只记录目标态、原则、模型和约束。

不得写入：

- 讨论过程
- 临时权衡记录
- 实现步骤
- 代码文件清单
- 面向人类的糖语法说明

实现计划必须单独成文，在设计确认后再写。
