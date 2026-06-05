---
name: cxs
description: "Use proactively for local Codex history and personal setup archaeology. Trigger when the user asks what was discussed/done/configured before, or asks inventory of this Mac's configured servers/VPS/nodes/accounts/domains/providers/services: 本机有哪些服务器配置/都配过啥服务/配过/配置过/装过/调过/之前/上次/刚刚/前几天/我记得/翻旧 session/历史对话. Includes '本机有哪几台服务器的配置，都配过些啥服务' even without cxs. Use before or alongside memory/live inspection. Do not use for current repo code search, known-file reads, web docs, daily summaries, or session wrap-up."
---

# cxs

用 `cxs` 在自己的 SQLite index 里检索旧 Codex 对话。当前公开 CLI source 只有 `codex`；`--source codex` 可省略，`claude-code` 是 reserved/non-public，不要把它说成可同步或可查询。Codex 的 raw sessions 只是 ingest source；正常历史检索只读 cxs index,不要让用户切换 source root 去追 raw 文件位置。心法:**先选 retrieval primitive,再定位候选 session,最后用 cxs read 命令拿内容证据**。

## 安装(两步)

**1. 装 cxs CLI**(本 skill 不带 CLI 包,只是 agent 工作流):

详见 README 的 [CLI Install Guide](https://github.com/catoncat/cxs#cli-install-guide)。安装后做一次 sanity:

```bash
"${CXS_BIN:-cxs}" --version       # 应输出 cxs 版本号
"${CXS_BIN:-cxs}" --help          # 应列出 status/sync/find/read-range/read-page/list/stats
"${CXS_BIN:-cxs}" status --help   # 若显示 --source <id>, public source 只有 codex
```

如果 `cxs` 不在 PATH 里,设 `export CXS_BIN=/absolute/path/to/bin/cxs`。如果安装版
`status --help` 没有 `--source`,说明 CLI 早于 source-aware 行为；省略 source flags,
或先更新到包含该行为的 CLI 发布版。

**2. 装 skill**:

```bash
# Codex agent runtime
npx skills add catoncat/cxs --full-depth --skill cxs -g -a codex -y

# 其他 agent runtime — 把 -a codex 换成对应 runtime,或省略
```

`-a` 取值依赖目标 agent runtime,**装错 slot 会看不到 skill**。这只是在对应 agent runtime 安装 skill，不代表 `cxs` 支持该 runtime 的 session source。装完通常需要重启 agent / 开新 session。

## 先选 retrieval primitive

不要把 `status -> sync -> find/list -> read` 当固定起手。先判断用户真正需要哪种 primitive:

| 用户需要 | 起手 primitive | 证据规则 |
| --- | --- | --- |
| metadata projection: 最早/最新、数量、分布、cwd/session 清单、大 session、时间排序 | 只读 SQLite/bash/jq 查询 cxs index 的 `sessions` 表;必要时用 `list` 辅助 | 只能投影稳定 metadata;任何内容判断都要再 `read-page` / `read-range` |
| semantic recall: 主题、关键词、"之前讨论过 X 吗"、本机配置考古 | `cxs find <query> --json`,按需要带 `--cwd` / `--root` / `--selector` / `--sort ended` | 用 `find` 召回候选,再用 `read-range` 或 `read-page` 验证 |
| context reading: 已知 `sessionUuid`、命中 seq、或需要扩大上下文 | `cxs read-range <uuid> --seq/--query [--before N --after M]` 或 `cxs read-page <uuid>` | 内容证据只来自 `read-*` 输出 |
| coverage/freshness/index availability: 索引缺失、coverage stale、要决定是否同步 | `cxs status --json` / `status --cwd` / `status --selector` | `status` 不回答内容问题,只决定 coverage 和 sync 需求 |
| mutation: 建索引或更新 coverage | `cxs sync --cwd/--root/--selector` | 普通检索不要 `--prune`;只有用户明确要求清理已消失 source 的旧索引记录才用 |

在支持 source-aware CLI 的版本里,所有固定命令都可带 `--source <id>`；当前只用 `codex`，省略等价于 `--source codex`。遇到 `unsupported_source`，不要改用 raw source root，也不要声称 Claude Code 支持已发布。如果安装版直接报 unknown option `--source`,它是旧 CLI；省略 source flags 或更新 CLI。

`find` / `list` 返回零结果不是结束条件。遇到零结果、用户说“应该有”、问题涉及最近/当前 repo、或 JSON 里有 `nextAction` 时,必须先按同一范围做 coverage check:

1. `status --cwd <path> --json` / `status --root <dir> --selector '<json>' --json`
2. 若 `requestedCoverage.recommendedAction === "sync"`,跑同范围 `sync --cwd` / `sync --root` / `sync --selector`
3. 再用同一 selector 重试 `find` / `list`;只有 fresh coverage 下仍无结果,才说没找到

只读 SQLite 只允许查 cxs 自己的 index,不要查 Codex raw JSONL 或其他 source roots。稳定 session metadata 字段限于:`source_id`, `native_session_id`, `session_key`, `session_uuid`, `started_at`, `ended_at`, `cwd`, `title`, `summary_text`, `message_count`, `source_root`, `file_path`。

**反例**(应该用别的工具):

- 当前 repo 代码/字符串搜索 → 代码搜索工具
- 当前文件或已知路径阅读 → 文件读取工具
- 外部文档/网页 → WebFetch / WebSearch
- 只问当前 live state 且无历史配置语义 → 运行态/文件检查；但若问题带"配过/以前/本机有哪些配置"语义,先用 cxs 找历史线索再验证 live truth
- 今日提交/日报 → `commit-daily-summary`
- 当前会话收尾 → `session-wrap`

## 工作流心法

- cxs index 是历史检索 source of truth；bash/sqlite/jq 只是 cheap projection/orchestration,不是内容证据层
- `status` 不是通用第一步；只有 coverage/freshness/index availability/source inventory 问题才先用它
- `find` 用于 semantic recall；metadata-only 问题不要硬走全文检索
- `read-range` / `read-page` 是内容证据层；回答"当时说了什么/决定了什么"前必须读内容
- `sync` 只是写入/更新 SQLite index 和 coverage;查找本身不需要 sync。只有目标范围 coverage 缺失或 stale 时才 `sync --cwd <path>` / `sync --root <dir>` / `sync --selector`
- `sync` 默认保留已索引历史；raw JSONL 从 source snapshot 中消失后，不要引导用户改查另一个 root。只有用户明确要让 cxs 丢弃 source 中已经消失的旧记录时才用 `sync --prune`
- 用 `status --cwd <path> --json` 或 `status --selector '<json>' --json` 检查目标范围；`requestedCoverage.recommendedAction === "query"` 时直接查，`"sync"` 时才同步
- `stats.sessionCount` 很多不等于目标范围有 source-aware complete coverage；fresh `{"source":"codex","kind":"all",...}` coverage 可以覆盖同 source/root 下的 cwd/date 子 selector
- "最新/最近 + 关键词"不要直接把默认 `find` 结果当最新；用 `find <query> --cwd <path> --sort ended` 或 `find <query> --root <dir> --sort ended`，必要时 `--exclude-session <current_uuid>` 排除当前会话/self-hit
- 混合自然语言 + 英文技术词的问题可以先直接 `find` 原句；新版 CLI 在严格召回为 0 时会保守提取 ASCII 技术词做一次 relaxed recall。仍要用 `read-range` / `read-page` 验证内容，不要只凭命中标题下结论。
- `matchSource = "session"` 时 `matchSeq = null`;这种命中先 `read-page` 抽样,**不要伪造 `read-range --seq`**
- 用户给 cwd 但不确定 sync 状态 → `status --json`;确认绝对 cwd 后跑 `status --cwd <path>`;缺失/stale 才 `sync --cwd <path>`
- `find --json` / `list --json` 零结果时看 `nextAction`:它是防止 agent 放弃的机器可读提示。按提示选择/检查 selector、必要时同步、再重试。
- `cwd` 只是候选过滤,不是主题真相;还要再看 `title`、`summaryText`、开头几条 message
- 同主题可能多个 uuid;按 `cwd / startedAt / matchCount` 选,不要按 title 脑补去重

## 结果回述（给用户，克制）

cxs 的工具输出在对话里通常是折叠的，只有你（agent）看得到。满足下面条件时，
你**必须**在回述里克制地带一句效率尾注，让用户感知到「快 / 省」；但绝不刷屏、
绝不诱导自己少读。

- 仅当答案确实压在一次**有规模**的 cxs 调查上（检索语料上了量级，或跨多个
  session / 多次 read）时，在实质答案末尾追加**最多一句**效率尾注。
- 措辞锚到 CLI header 里的**真实测量值**：检索覆盖规模（find 的「检索 ~N 条」）、
  实际读取条数（各次 read 的「读取 K 条」累加）、端到端耗时（各次 `Xms` 粗略
  相加）。模板：`（从 ~N 条历史里用 ~Yms 定位，读了 Z 条）`。
- 跨多次调用就把读取条数和 ms **粗略加总，只报量级、不假装精确**。
- **不报编造的「省 X%」**。「省」靠两个真实数字的落差自己说话（17 万条里读了几条），
  不要挂一个估出来的分母。
- **绝不**在零结果 / coverage-miss / 单条直查时附效率尾注——没找到、或本来就没
  省下什么时说「省」= 自打脸。
- 这一句是**给用户看的答案尾注**，和下面「使用后自评」（内部反思、不输出给用户）
  是两回事，不要混。
- 效率回述默认开。用户嫌吵可设 `CXS_STATS=0`（或 `off`）关掉 CLI header 里的
  注解；这时文本里就没有「检索 ~N 条 / 读取 K 条 / Xms」可锚，**别硬编数字**，
  直接省掉效率尾注即可（`--json` 的 `scannedMessageCount` / `elapsedMs` 不受影响）。

## 使用后自评

每次用 cxs 回答完，都做一次轻量自评；不要把这段长篇输出给用户，只在有问题时简短暴露结论。

这个自评和 `$cxs-dogfood` 是配套流程：`cxs` 只发现并提示可记录的 case，`cxs-dogfood` 才负责交互式采集、写入私有 golden、跑 eval、生成修复 handoff。

判断这次结果属于哪类：

- `good`: 找到的 session/cwd/时间/上下文能支撑答案。
- `query-refine`: 第一条 query 不理想，但通过改关键词、selector、`--sort ended`、`--exclude-session` 等正常使用方式解决了。
- `coverage-issue`: 问题来自索引缺失/stale 或 selector 没覆盖；应说明需要 `status --cwd` / `sync --cwd` / `sync --root` / `status --selector` / `sync --selector`，不要归因给排序。
- `skill-guidance-issue`: cxs CLI 没错，是 agent 没按 skill 流程用，比如把默认 `find` 当最新、伪造 `read-range --seq`、跳过 selector。
- `dogfood-candidate`: 仍有可复现的不符合预期，例如 recall miss、明显错排、上下文窗口不对、session hit/message hit 行为让 agent 难以稳定使用。

如果是 `dogfood-candidate`：

1. 不要自动写私有 golden；`cxs-dogfood` 只能由用户显式触发。
2. 给用户一句可直接确认的提示，例如：

   ```text
   这次像是 cxs dogfood candidate：<一句话原因>。如果要记录，直接说 `$cxs-dogfood 记录这个 case`。
   ```

3. 在当前回复中保留足够 handoff 线索：原始 query、实际 top1/竞争项、期望 session/cwd 或缺失的上下文短语。
4. 如果用户随后说“记录/加进去/对，记录这个 case”，把它视为显式触发 `cxs-dogfood`，由那个 skill 交互式补齐和验证。
5. 不要在 `cxs` skill 内继续设计修复方案；记录完成后的“是否启动修复 / 输出 handoff”由 `cxs-dogfood` 收尾处理。

## 前置

- 如果只是 metadata projection,先读 cxs SQLite index;不需要先跑全文 `find`
- 如果只是 semantic recall,先 `find`;目标 coverage 不明或返回 `index_unavailable` 时再用 `status`
- 只有需要 coverage/freshness/index availability 时,才先 `status --json` 或 `status --cwd <path> --json` / `status --selector '<json>' --json`
- 索引不存在、读命令返回 `index_unavailable`、或 `requestedCoverage.recommendedAction === "sync"` → `sync --cwd <path>` / `sync --root <dir>` / `sync --selector '<json>'`
- `sync` 默认严格模式;只有用户接受部分成功才加 `--best-effort`;best-effort 不写 complete coverage
- `sync --prune` 是显式清理动作,会删除所选 source 中已经消失的旧索引记录；普通历史查询和日常增量同步不要加
- 从别的 cwd 调用时,若默认 db 不对,显式传 `--db`

## 参考

详细命令面、字段、流程、错误处理:

- [`references/cli-surface.md`](references/cli-surface.md) — 每个子命令的 options + Example
- [`references/progressive-workflow.md`](references/progressive-workflow.md) — 4 个 worked scenarios
- [`references/json-schema.md`](references/json-schema.md) — 完整 JSON 字段
- [`references/failure-cookbook.md`](references/failure-cookbook.md) — 错误症状速查 / `--json` error shape 速查
- [`references/advanced-queries.md`](references/advanced-queries.md) — query 语义 / 只读 SQLite metadata projection / CJK 行为

# skill-sync: distributable cxs skill package, zero-result coverage retry workflow, 2026-06-02
