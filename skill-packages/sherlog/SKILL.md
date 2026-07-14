---
name: sherlog
description: "Use proactively for local agent-session history and prior setup archaeology. Trigger when the user asks what was discussed/done/configured before, asks which local servers/services/accounts/domains/providers were configured, or says 之前/上次/配过/装过/历史对话/翻旧 session. Not for current-repo code search, live-only state, web docs, daily summaries, or session wrap-up."
---

# Sherlog

用 `shlog` 在 Sherlog SQLite index 里做历史检索。心法：**先选 retrieval primitive，再定位候选 session，最后取内容证据**。

命令默认写法：

`"${SHLOG_BIN:-${CXS_BIN:-shlog}}" <subcommand> ...`

## 先选 retrieval primitive

| 用户需要 | 起手 primitive | 完成标准 |
| --- | --- | --- |
| metadata projection：最早/最新、数量、分布、cwd/session 清单、大 session | 只读 SQLite 查询 index 的 `sessions` 表；必要时 `list` | metadata 候选完整；涉及内容时已再用 `read-*` 验证 |
| semantic recall：主题、关键词、历史配置考古 | `find <query> --json`；按需加 `--cwd/--root/--selector` | 已执行结果的 `evidenceRead.argv`，不只看 title/snippet |
| context reading：已知 `sessionRef` / seq | `read-range` 或 `read-page` | 已读足够上下文回答问题 |
| coverage / freshness / index availability | `status --json` / `--cwd` / `--selector` | 已按 `recommendedAction` 决定 query 或同范围 sync |
| mutation：建索引或更新 coverage | bare `sync`（first-install Codex bootstrap）或 scoped `sync` | sync 无未解决 error；cold 迁移已注册 cold root |

## Canonical policy

本节是 sort / evidence / coverage / cold / prune 的单一策略真相；references 只给场景和命令细节。

| policy | rule |
| --- | --- |
| Evidence | `find/list` 只定位候选；内容先执行 `evidenceRead.argv` / `read-*`。只有 index projection 明确缺少完整 tool call、patch、长代码或原始事件时，才在定位 session 后走 agent-side raw fallback。 |
| Sort | `find` 默认 relevance；用户问最新/最近时用 `--sort ended`，必要时 `--exclude-session` 排除 self-hit。 |
| Coverage | 跟随同范围 `nextAction`。Codex `source_content_changed` + `recommendedAction: "query"` 是 soft stale：先 query/read；只有答案依赖最新活跃尾部时才 sync。 |
| Cold | `cold add` 只注册 presence 供 prune 保留。`sync` 只摄取 plain `*.jsonl`；不会从 cold `*.jsonl.zst` 重建 index。 |
| Prune | 普通维护不用 `--prune`。只有用户明确要丢掉 hot 与已注册 cold 都不存在的历史时才 prune。 |

## 使用规则

- 跨 source 读取使用 `find` 返回的 `sessionRef`，不要从 uuid 猜 source。
- `matchSource = "session"` 时 `matchSeq = null`；仍优先执行 `evidenceRead.argv`，因为 session-level hit 可能使用 `read-range --query`。
- raw full-text 是 `rg` / `rg -z` / `zstd -d` 等 agent-side 取证，不是 `shlog` 子命令。细节见 `references/progressive-workflow.md`。

## 不适用

当前 repo 代码搜索、已知路径阅读、外部文档/网页、无历史语义的 live state、日报、当前会话收尾。

## 每次使用后的轻量自评

内部归类为一种：`reliable` / `needs-refine` / `coverage-issue` / `skill-guidance-issue` / `dogfood-candidate`。

- 前四类按需 refine、sync 或说明边界。
- 若发现可复现的 recall / ranking / context 问题，只建议用户显式说 `$sherlog-dogfood 记录这个 case`；不要自动写或 promote 私有 golden。
- 大规模检索可用真实扫描量/耗时做一句尾注；无真实数字不报。

## 参考

按需加载，默认不要全读：

- `references/progressive-workflow.md` — scenarios + raw fallback
- `references/failure-cookbook.md` — nextAction / errors / recovery
- `references/cli-surface.md` — 命令与 options
- `references/advanced-queries.md` — FTS / CJK / metadata SQL
- `references/json-schema.md` — 仅解析字段或 error shape 时

# skill-sync: canonical retrieval policy + raw fallback
