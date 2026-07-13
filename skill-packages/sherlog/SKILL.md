---
name: sherlog
description: "Use proactively for local Codex history and personal setup archaeology. Trigger when the user asks what was discussed/done/configured before, or asks inventory of this Mac's configured servers/VPS/nodes/accounts/domains/providers/services: 本机有哪些服务器配置/都配过啥服务/配过/配置过/装过/调过/之前/上次/刚刚/前几天/我记得/翻旧 session/历史对话. Includes '本机有哪几台服务器的配置，都配过些啥服务' even without Sherlog. Use before or alongside memory/live inspection. Do not use for current repo code search, known-file reads, web docs, daily summaries, or session wrap-up."
---

# Sherlog

用 `shlog` 在 Sherlog SQLite index 里检索旧 agent 对话。心法: **先选 retrieval primitive,再定位候选 session,最后用 `read-*` 拿内容证据**。

命令默认写法:

`"${SHLOG_BIN:-${CXS_BIN:-shlog}}" <subcommand> ...`

## 先选 retrieval primitive

不要把 `status -> sync -> find/list -> read` 当固定起手。按用户问题选择:

| 用户需要 | 起手 primitive | 证据规则 |
| --- | --- | --- |
| metadata projection: 最早/最新、数量、分布、cwd/session 清单、大 session、时间排序 | 只读 SQLite/bash/jq 查询 Sherlog index 的 `sessions` 表;必要时用 `list` 辅助 | 只能投影稳定 metadata;任何内容判断都要再 `read-page` / `read-range` |
| semantic recall: 主题、关键词、"之前讨论过 X 吗"、本机配置考古 | `shlog find <query> --json`,默认跨 public sources；按需要带 `--cwd` / `--root` / `--selector` / `--sort ended` | 用 `find` 召回候选,再用结果里的 `sessionRef` 做 `read-range` 或 `read-page` 验证 |
| context reading: 已知 `sessionUuid` / `sessionRef`、命中 seq、或需要扩大上下文 | `shlog read-range <sessionRef> --seq/--query [--before N --after M]` 或 `shlog read-page <sessionRef>` | 内容证据只来自 `read-*` 输出 |
| coverage/freshness/index availability: 索引缺失、coverage stale、要决定是否同步 | `shlog status --json` / `status --cwd` / `status --selector` | `status` 不回答内容问题,只决定 coverage 和 sync 需求 |
| mutation: 建索引或更新 coverage | `shlog sync`（first-install 默认 Codex bootstrap）或 `shlog sync --cwd/--root/--selector` | 普通检索不要 `--prune`；Agent 有范围时优先 scoped sync。用户冷迁/压缩 raw 后应 `shlog cold add --root <archived>`，再 sync；`--prune` 只删 hot 与已注册 cold 都不存在的行 |

## 硬规则

- Sherlog index 是正常历史检索的 source of truth；不要为正常查询改查 raw JSONL 或其他 source root。
- 回答"当时说了什么/决定了什么"前必须用 `read-range` / `read-page` 读内容；`find`、title、summary 只能定位候选。
- `find` 默认跨 public indexed sources 搜索；只有用户指定、缩小范围或诊断时才加 `--source codex|claude-code|pi`。
- 后续读取优先使用 `find --json` 返回的 `sessionRef`；不要从 uuid 自己猜 source。
- `find --json` 结果优先跟随 `evidenceRead.argv` 读取证据；`matchSource = "session"` 时 `matchSeq = null`,不要伪造 `read-range --seq`。
- `find` 默认按 relevance 排序；"最新/最近 + 关键词"用 `--sort ended`,必要时 `--exclude-session <current_uuid>` 排除 self-hit。
- 只读 SQLite 只允许查 Sherlog index 的稳定 metadata；内容判断仍回到 `read-*`。
- `sync` 只更新 index/coverage。coverage 缺失或确实 stale 时才同步同一范围。
- 用户把 Codex raw 冷迁到 `archived_sessions` 或压成 `.jsonl.zst` 后：检索仍走 Sherlog index；先 `shlog cold add --root <cold>` 注册冷根，再普通 `sync`。冷迁不是“该 prune 的历史”。
- `sync --prune` 只删 **hot source 与已注册 cold root 中都不存在** 的索引行；不要为“对齐 coverage / 清理 index”随手 prune。只有用户明确要丢掉真 missing 历史时才 prune。

## Coverage / Failure Gate

`find/list/read-*` 的零结果或错误通常不是最终结论。先看 JSON 里的 `nextAction`,并保持同一 source/selector/cwd/root 处理 coverage:

- `index_unavailable`: 普通首次安装可 `sync`;明确项目范围优先 `sync --cwd <path>`。
- `session_not_found`: 只说明当前 index 没有这个 `sessionRef`;按 `nextAction` 检查 source/id/coverage,必要时同 source scoped sync 后重试。
- `stale_or_missing_coverage`: 先判断是否需要完整结论。`find --json` 的 coverage 会做 live freshness 评估；`complete=false` 只表示不能证明当前 raw snapshot 已完整覆盖，不表示已有索引不可查询。Codex `source_content_changed` 常是活跃尾部软 stale,非空结果可先 query/read；coverage 缺失、source set 变化、非 Codex 保守同步、零结果可疑或用户要求完整性时,按 `nextAction` 同范围 sync 后重试。
- `sync` 成功但 `coverage.staleReason: "source_content_changed"`: Codex 活跃 JSONL 在读取后继续追加；已读边界和其他稳定 source 已安全落库，可继续 query/read，稍后再 sync 补尾部。截断、前缀改写和 source set 变化仍是失败，不要把它们当成同一类软 stale。
- `sync` 成功但 `coverage.reason: "active_source_deferred"`: 尚未索引的新 Codex 文件在有界读取前已变化，无法证明是纯追加；该文件和 complete coverage 被保守延后，其他稳定 source 已落库。按 `recommendedAction: "sync"` 重试，不要把本轮结果当完整覆盖。
- fresh coverage 下仍无结果,才说没找到。

## 不适用

- 当前 repo 代码/字符串搜索 -> 代码搜索工具。
- 当前文件或已知路径阅读 -> 文件读取工具。
- 外部文档/网页 -> WebSearch / WebFetch。
- 只问当前 live state 且无历史配置语义 -> 运行态/文件检查；带"配过/以前/本机有哪些配置"语义时,先用 Sherlog 找历史线索再验证 live truth。
- 今日提交/日报 -> 对应日报工具；当前会话收尾 -> `session-wrap`。

## 回述与自评

- 大规模检索时,可以用真实 header / JSON 里的扫描量、读取量、耗时做一句简短尾注；没有真实数字就不报。
- 回答完内部轻量自评: `good` / `query-refine` / `coverage-issue` / `skill-guidance-issue`。只在有问题时向用户简短说明边界或需要的 refine/sync。

## 参考

按需读取,不要默认全量加载:

- `references/progressive-workflow.md`: 不确定该选哪种 primitive,或需要 worked scenario。
- `references/failure-cookbook.md`: 遇到 `nextAction`、coverage stale/missing、`session_not_found`、旧 schema、锁、零结果。
- `references/cli-surface.md`: 需要完整命令 options、安装/版本兼容、source-aware 细节。
- `references/advanced-queries.md`: metadata SQLite projection、CJK/query 语义、缩范围策略。
- `references/json-schema.md`: 需要解析完整 JSON 字段或 error shape。

# skill-sync: distributable sherlog skill package, cold retention + prune presence, 2026-07-13
