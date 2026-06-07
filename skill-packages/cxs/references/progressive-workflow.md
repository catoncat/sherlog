# Progressive Workflow

## Core Rule

Start by choosing the retrieval primitive, not by running a fixed command chain.

1. Metadata projection -> read-only SQLite/bash/jq over the cxs index.
2. Semantic recall -> `find`.
3. Content verification -> `read-range` / `read-page`.
4. Coverage or freshness diagnosis -> `status`, then `sync` only when needed.

Hard rules:

- cxs index is the normal history source of truth; do not query raw Codex JSONL or alternate source roots during normal retrieval.
- Read-only SQLite can shortlist sessions, counts, dates, cwd distributions, and other stable metadata.
- Stable session metadata fields are `source_id`, `native_session_id`, `session_key`, `session_uuid`, `started_at`, `ended_at`, `cwd`, `title`, `summary_text`, `message_count`, `source_root`, `file_path`.
- Content claims require `read-range` or `read-page`.
- `sync` only updates index/coverage; normal retrieval does not need `sync` unless coverage is missing or stale.
- Do not use `sync --prune` for normal retrieval.
- `find` default sort is relevance; use `--sort ended` only when the user's question is time-oriented.
- `matchSource = "session"` means `matchSeq = null`; use `read-page` instead of inventing a seq.
- Current public sources are `codex` and experimental `claude-code`; omit `--source` or pass `--source codex` for the default. Claude Code is part of the normal CLI surface now, but it is still not a stable raw-format promise.

## Scenario 1: Metadata Projection

用户说：`查下我们机器上最早的有意义的对话是哪个`

先用只读 SQLite 快速列候选。这里只判断 metadata,不读 raw files:

```bash
DB_PATH="$("${CXS_BIN:-cxs}" status --json | jq -r '.context.dbPath')"
sqlite3 -readonly "$DB_PATH" \
  "SELECT session_uuid, started_at, message_count, cwd, title
   FROM sessions
   WHERE message_count > 0
   ORDER BY started_at ASC
   LIMIT 10;"
```

然后挑候选 session,用 cxs content primitive 验证是否"有意义":

```bash
"${CXS_BIN:-cxs}" read-page <sessionUuid> --offset 0 --limit 20 --json
```

不要用 `find` 或 broad `status` 去回答这种 metadata-first 问题。

## Scenario 2: Semantic Recall

用户说：`上次我配 cf tunnel 是怎么弄的`

这类需要主题召回,用 `find`:

```bash
"${CXS_BIN:-cxs}" find "cf tunnel" --root /Users/me/.codex/sessions --json -n 5
```

如果命令返回 `index_unavailable`,或者你需要确认目标范围 coverage,再用 `status` / `sync`:

```bash
"${CXS_BIN:-cxs}" status --root /Users/me/.codex/sessions --selector '{"kind":"all"}' --json
"${CXS_BIN:-cxs}" sync --root /Users/me/.codex/sessions --json
```

候选出来后读内容:

```bash
"${CXS_BIN:-cxs}" read-range <sessionUuid> --seq <matchSeq> --before 4 --after 8 --json
```

如果 `matchSeq` 是 `null`,改用:

```bash
"${CXS_BIN:-cxs}" read-page <sessionUuid> --offset 0 --limit 40 --json
```

## Scenario 3: Coverage Diagnosis

用户说：`为什么这个 repo 的历史查不到`

这类才以 `status` 开始:

```bash
"${CXS_BIN:-cxs}" status --cwd /absolute/path/to/current/repo --json
```

看 `requestedCoverage.recommendedAction`:

- `"query"`: coverage fresh,继续 `find` / `list`。
- `"sync"`: 同范围同步。

```bash
"${CXS_BIN:-cxs}" sync --cwd /absolute/path/to/current/repo --json
```

不要为了 coverage diagnosis 改查 raw source files;问题应该通过 cxs coverage/index 状态解释。

## Scenario 4: Content Verification

用户说：`这个 session 里当时到底决定了什么`

如果已有 `sessionUuid`,直接读内容:

```bash
"${CXS_BIN:-cxs}" read-range <sessionUuid> --query "决定" --before 6 --after 10 --json
```

窗口还不够时翻页:

```bash
"${CXS_BIN:-cxs}" read-page <sessionUuid> --offset 0 --limit 60 --json
```

metadata、title、summary 只能帮助定位;不要只凭这些字段下内容结论。

## 来源

- 仓库内 `README.md`
- 仓库内 `src/query.ts`
- 仓库内 `src/query/read.ts`
- 仓库内 `src/types.ts`
