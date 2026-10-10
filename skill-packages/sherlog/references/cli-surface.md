# CLI Surface

精确语法、选项和默认值以 `shlog --help` / `shlog <command> --help` 为准。这里只记录 help 通常不会强调的跨命令语义陷阱。

## Command purpose / side effect

| 命令 | 用途 | 副作用 |
| --- | --- | --- |
| `find` | 主题/关键词召回 candidate | 只读 |
| `list` | 会话清单（项目/时间浏览） | 只读 |
| `read-range` / `read-page` | 读取会话内容证据 | 只读 |
| `stats` | 数量/时间/DB 概览 | 只读 |
| `status` | coverage / freshness / index layout | 只读（不返回正文） |
| `sync` | 建立/更新 index 与 coverage | 唯一 content/index writer |
| `cold add/remove` | 冷存 retention state | add/remove 写；list 只读 |
| `--prune` | 删除 hot/cold 都不存在的 projection | 破坏性，需用户明确授权 |

## 跨命令语义陷阱

- **`find` vs `list`**：`find` 按内容召回；`list` 按项目/时间浏览，关键词弱时用。
- **`list --cwd` vs `find --cwd`**：`list --cwd` 是 case-insensitive metadata substring filter；`find --cwd` 构造 exact cwd selector。两者的 coverage 语义不同，不要混用。
- **same selector**：`status`、必要的 `sync`、retry 必须用相同 source/root/selector，否则 coverage proof 不匹配。
- **读全 vs 写一**：`find` 省略 `--source` 搜全部 source，`sync` 省略 `--source` 只写默认 Codex。非 Codex source 的 freshness 必须显式 `shlog sync --source <id>`；裸 `shlog sync` 会留下一头显示 `covered`、实际已经过期的索引。
- **source-qualified `sessionRef`**：跨 source 读取用 `find` 返回的 `sessionRef`（如 `claude-code:<native-id>`、`dsh:<native-id>`）；bare UUID 被默认按 Codex 解释，不要从 UUID 猜 source。
- **`--max-message-chars 0`**：正文过长会 elision；关键句不可见时用 0 禁用 elision 读取全文。
- **strict vs `--best-effort`**：strict 遇错误不发布 complete coverage；`--best-effort` 可提交成功 projection，但带 `errorDetails` 且不表示 complete。
- **`--prune` / `cold remove`**：破坏性；只在用户明确表达删除意图后执行，普通检索不使用。
- **`--selector` 与 `--cwd` 互斥**；显式 `--source` 必须与 selector source 一致。

## Selector shape

```json
{"source":"codex","kind":"all","root":"/abs/sessions"}
{"source":"codex","kind":"cwd","root":"/abs/sessions","cwd":"/abs/repo"}
{"source":"codex","kind":"date_range","root":"/abs/sessions","fromDate":"2026-08-01","toDate":"2026-08-15"}
{"source":"codex","kind":"cwd_date_range","root":"/abs/sessions","cwd":"/abs/repo","fromDate":"2026-08-01","toDate":"2026-08-15"}
```

CLI 可补默认 root/source。

## Exit / output

- 文本输出（默认）是 agent 的主输出：`find`/`list` 每条 candidate 一个短块——`[rank] 日期 · source · cwd · seq N | session-level · N hits`、标题（去掉 `[$skill](…)`/`[@plugin](…)`/`<command-*>` 包装）、`summary:`（标题之后的摘要）、`match:`（命中片段，与标题重复时省略）、`read:`（可原样执行；索引不是默认路径时自带 `--db`）。开头 `coverage:` 一行是各 source 的 stored proof（covered/uncovered），不是 freshness。零结果时打印 `hint:`、`try:` 与 `next:`。
- `--json` 是同一结果的完整 contract（含 `evidenceRead`、完整 coverage、`zeroResults`），体积约为文本的 4–5 倍，只在需要程序化解析时使用。
- success：0；failure：non-zero。
- typed business errors + `--json`：stdout 输出 `{"error":{...}}` envelope。
- strict sync `--json` 失败：sync 报告写 stderr；`--best-effort` 的 sync 报告写 stdout。
- CLI parser error（如漏 `<query>`）：plain stderr，不包装 JSON。
