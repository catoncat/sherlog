# Progressive Workflow

Apply `SKILL.md` **Canonical policy** in every scenario; this file provides branches and completion criteria, not alternate policy definitions.

## Scenario 1: Metadata Projection

用户说：`查下最早的有意义的对话是哪个`

```bash
DB_PATH="$("${SHLOG_BIN:-${CXS_BIN:-shlog}}" status --json | jq -r '.context.dbPath')"
sqlite3 -readonly "$DB_PATH" \
  "SELECT session_key, started_at, message_count, cwd, title
   FROM sessions
   WHERE message_count > 0
   ORDER BY started_at ASC
   LIMIT 10;"
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-page <session_key> --offset 0 --limit 20 --json
```

完成：候选来自 index metadata；“有意义”已用 `read-*` 验证。

## Scenario 2: Semantic Recall

用户说：`上次我配 cf tunnel 是怎么弄的`

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" find "cf tunnel" --json -n 5
```

对候选始终执行 `evidenceRead.argv`；不要根据 `matchSeq` 自己重建命令。示例形状可能是：

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-range <sessionRef> --seq <matchSeq> --query "cf tunnel" --before 2 --after 2 --json
# session-level hit 也可能由 evidenceRead 给出：
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-range <sessionRef> --query "cf tunnel" --before 2 --after 2 --json
```

只有旧 CLI 结果完全没有 `evidenceRead` 时，才 fallback `read-page <sessionRef>`。

完成：已读内容证据，不只 title/snippet。

## Scenario 3: Current Project Discussion

用户说：`最近这个项目讨论了什么`

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" list --cwd <repo-cwd> --sort ended -n 8 --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-page <sessionRef> --offset 0 --limit 8 --json
```

索引不可用或 coverage 可疑时再 `status --cwd <repo-cwd>` / `sync --cwd <repo-cwd>`。

完成：候选 metadata 已列出；最终结论已读取相关 session 的开头、结尾或命中上下文。

## Scenario 4: Recent Keyword

用户说：`最新一次提到 X 是哪个 session`

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" find "X" --cwd <repo-cwd> --sort ended --exclude-session <current-session-ref> --json -n 5
```

随后执行首个候选的 `evidenceRead.argv`。

完成：已验证 session 内容确实提到 X，并按 `endedAt` 判断最新，不只依赖排序后的 snippet。

## Scenario 5: Coverage Diagnosis

用户说：`为什么这个 repo 的历史查不到`

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" status --cwd <repo-cwd> --json
```

按 `SKILL.md` Coverage policy 和返回的 `recommendedAction` 处理；需要 sync 时保持同一 selector/cwd/root。

完成：已 retry 必要操作；仅在可证明 coverage 足够后下“没找到”结论。

## Scenario 6: Content Verification

用户说：`这个 session 里当时到底决定了什么`

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-range <sessionRef> --query "决定" --before 6 --after 10 --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-page <sessionRef> --offset 0 --limit 60 --json
```

完成：内容结论来自足够的 `read-*` projection。

## Scenario 7: Raw Full-Text Fallback

只在 `read-*` projection 明确不足以回答完整 tool call / patch / 长代码 / 原始事件时进入：

1. 先用 Sherlog 定位 `sessionRef` / 时间 / cwd / source。
2. cold 路径来自 `shlog cold list --json` 或用户明确路径。
3. 在对应 raw root 取证：hot 通常是 plain `*.jsonl`；cold 可能是逐文件 `*.jsonl.zst`。
4. 这是 agent-side fallback，不是 `shlog` 子命令，也不代表 cold zst 可被 sync 重建。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" cold list --json
rg "exact clue" <hot-or-cold-root> --glob '*.jsonl'
rg -z "exact clue" <cold-root> --glob '*.jsonl.zst'
zstd -d <cold-session-file>.jsonl.zst -o /tmp/sherlog-session.jsonl
```

完成：已先定位 session；只读取相关 raw；回答明确区分 index projection 与 raw transcript 证据。

## 来源

- `src/query.ts`, `src/query/read.ts`, `src/types.ts`, `src/cold-roots.ts`
