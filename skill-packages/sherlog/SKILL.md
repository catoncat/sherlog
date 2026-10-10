---
name: sherlog
description: "Search local agent-session history to recover prior decisions, commands, configurations, and context from earlier sessions. Use for cross-session recall when the current task depends on what happened in a previous agent conversation, not for inspecting the current repository or summarizing the current session."
---

# Sherlog

用 `shlog` 检索本机 agent session 历史。命令语法与默认值以 `shlog --help` 和 `shlog <command> --help` 为准；本 skill 只给 help 教不了的检索决策。

## 主循环

1. **定位**：按问题选 `find` / `list` / `stats`（usage 看 `--help`）。主题或关键词明确用 `find`；已知项目/时间、关键词弱用 `list`。默认不加 `--json`：文本输出每条 candidate 一个短块（日期 · source · cwd · 锚点、标题、摘要、命中片段）加一条可直接执行的 `read:` 命令，10 条约 2k token；`--json` 是同一结果的完整 contract，只在需要程序化解析字段时使用。前几条都不像时换更独特的词或 identifier（路径、命令、报错短语），而不是把整句自然语言追加进去。完成：有可读取的 candidate identity 和明确 scope。
2. **取证**：原样执行 candidate 的 `read:` 行（`--json` 时为 `evidenceRead.command`），或自行 `read-range` / `read-page`。完成：每个历史事实都有 `read-*` 返回内容支持；`hasMore=true` 且目标上下文未解决时继续翻页，抽样则说明边界。
3. **证明范围**：只在回答依赖 latest / completeness / miss 结论时，对相同 selector 跑 `status --json`。完成：按 `recommendedAction` 决定 query、同范围 sync，或说明无法证明。

`find` 默认搜全部 source，`sync` 默认只写 Codex：跨 source 结论依赖 freshness 时，对每个相关 source 用 `shlog sync --source <id>`（`claude-code` / `pi` / `dsh`），不要用裸 `shlog sync` 去补它们；文本输出的 `scope:` / `next:` 行与 JSON `nextAction` 会给出具体 source。
4. **报告**：不确定处明确说明；不伪造完整性或不存在的证据。

直接执行匹配任务的只读命令，不用 `status` / `sync` 预检；失败时按宿主权限原样执行 recommended（或唯一）typed `nextAction.commands[].command`。不要自行重建命令，也不要把 cwd/root/selector 查询扩成 `all(root)`。

## 不变量

- `find/read/list/stats/cold list` 只读；`sync` 是唯一 content writer；`cold add/remove` 只写 retention state。只读命令不隐式 sync/migrate。
- `find` 默认跨全部 source，`sync` 默认只写 Codex；裸 `shlog sync` 不会刷新 `pi`/`claude-code`/`dsh`，需要该 source 的 freshness 时显式 `--source <id>`。
- 内容事实只能来自 `read-*`；title/summary/snippet/profile 命中只是 candidate。文本输出的 `coverage:` 行是 stored proof，不是 freshness。
- message anchor 走 `read-range`；profile-only 命中不伪造 seq；`anchor_not_found` 时按 nextAction 回退。
- `find --cwd` 构造 exact cwd selector；`list --cwd` 是 substring filter，两者 coverage 语义不同。
- latest/completeness/miss 结论必须匹配同 selector 的 coverage proof。
- 破坏性操作（`sync --prune`、`cold remove`）只在用户明确表达删除意图后执行。
- 跨 source 读取使用 `find` 返回的 `sessionRef`，不从 UUID 猜 source。

## References（按触发条件加载）

- 遇到 typed error / zero results / 迁移升级：`references/failure-cookbook.md`
- 需要跨命令语义陷阱或 selector 形状：`references/cli-surface.md`
- 需要解析 `evidenceRead` / coverage / `nextAction` 字段：`references/json-schema.md`
- 需要具体场景示例与完成标准：`references/progressive-workflow.md`
- 需要 query/tokenizer 或只读 metadata SQL 细节：`references/advanced-queries.md`
