# Progressive Workflow

常见检索场景、命令与完成标准。不变量与错误恢复以 `SKILL.md` 和 `failure-cookbook.md` 为准；本文件只给场景示例，不重复 policy。

## 1. Semantic recall（主题 / 历史配置考古）

用户问：`上次我配 cf tunnel 是怎么弄的`

```bash
shlog find "cf tunnel" -n 5
```

文本输出每条 candidate 一个短块加 `read:` 命令（10 条约 2k token，`--json` 约 9–10k）；挑最像的 1–3 条，原样执行它的 `read:` 行。短产品名/通用文件名先加 `--cwd` 或换成更独特 phrase。跨 source 读取用输出里的 `sessionRef`（如 `claude-code:<native-id>`），不要从 bare UUID 猜 source。

完成：回答中的每个事实都能指到某条 `read-*` 返回的 message/session 内容；未验证的部分已说明不确定。

## 2. Project / time browsing（关键词弱）

用户问：`最近这个项目讨论了什么`

```bash
shlog list --cwd <repo-cwd-fragment> --sort ended -n 8
shlog read-page <list-sessionUuid> --offset 0 --limit 20
```

`list` 默认 source 是 Codex，每条带 `read:` 行；跨 source 读取优先用 `find` 取得 source-qualified `sessionRef`。

注意 `list --cwd` 是 metadata substring filter，不是 exact cwd selector。需要 coverage proof 时另用：

```bash
shlog status --cwd <absolute-repo-cwd> --json
```

完成：逐个读取回答实际引用的 session；若声称覆盖这批候选就全部检查，若只抽样就说明选取范围。任何 `read-page.hasMore=true` 且目标上下文仍未解决时继续翻页。

## 3. Latest keyword, excluding self-hit

用户问：`最近一次提到 X 是什么时候`

```bash
shlog find "X" --cwd <repo-cwd> --sort ended \
  --exclude-session <current-sessionRef> -n 5
```

按输出顺序执行 candidate 的 `read:` 行（`--json` 时为 `evidenceRead.command`），直到首个内容确认 phrase X 的结果；更靠前但尚未取证的 candidate 仍存在时不能声称“最新”。

完成：phrase X 已从 `read-*` 输出确认，且所有更晚 candidate 已取证并排除。

## 4. Known session decision

```bash
shlog read-range <sessionRef> --query "决定" --before 6 --after 10
shlog read-page <sessionRef> --offset 0 --limit 60
```

有 elision 且关键句不可见：

```bash
shlog read-range <sessionRef> --query "决定" --before 6 --after 10 \
  --max-message-chars 0
```

完成：目标结论已被 `read-range`/`read-page` 输出中的具体语句覆盖；若 `read-page` 报 `hasMore=true` 且还没看到目标上下文，继续翻页，不得提前结束。

## 5. Coverage diagnosis（可选）

用户问：`为什么这个 repo 的历史查不到`

```bash
shlog status --cwd <repo-cwd> --json
```

- `fresh + complete`：refine query；
- `missing/stale + sync`：同 source/root/cwd 用 `shlog sync --source <id>` 后再 retry；source 不是 codex 时不能用裸 `shlog sync` 代替；
- `source_content_changed + query`：现有 index 可先查，只有 latest tail 重要时再 sync。

完成：必要操作已重试；只在 coverage 可证明时下完整 miss 结论。
