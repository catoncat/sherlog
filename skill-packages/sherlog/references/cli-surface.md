# Sherlog CLI Surface

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" <subcommand> ...
```

未进 `PATH` 时设置 `SHLOG_BIN=/absolute/path/to/shlog`。
行为策略以 `SKILL.md` Canonical policy 为准；场景见 `progressive-workflow.md`；错误恢复见 `failure-cookbook.md`；JSON contract 见 `json-schema.md`。

## 全局约定

- 无单独 `init`；bare `sync` 是 first-install 默认 Codex bootstrap。
- 公开 source：`codex`、experimental `claude-code`、experimental `pi`。
- `find` 省略 `--source` = 全 public sources；其他命令省略 = Codex 兼容默认。
- read 优先消费 `find` 返回的 `sessionRef`。

## status

Purpose：执行上下文、source inventory、index 与 coverage 状态。不回答内容，不写状态。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" status --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" status --cwd <repo-cwd> --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" status --root <sessions-root> --selector '{"kind":"all"}' --json
```

Options：`--source`、`--root`、`--selector`、`--cwd`、`--db`、`--json`。

Selector shapes：

```json
{"source":"codex","kind":"all","root":"<sessions-root>"}
{"source":"codex","kind":"date_range","root":"<sessions-root>","fromDate":"<YYYY-MM-DD>","toDate":"<YYYY-MM-DD>"}
{"source":"codex","kind":"cwd","root":"<sessions-root>","cwd":"<repo-cwd>"}
{"source":"codex","kind":"cwd_date_range","root":"<sessions-root>","cwd":"<repo-cwd>","fromDate":"<YYYY-MM-DD>","toDate":"<YYYY-MM-DD>"}
```

`--root` 可补 `selector.root`；常见 cwd/root 用 shortcut，日期范围再写 JSON。

## sync

Purpose：按 selector 扫描 plain session JSONL 并写入 SQLite。

| option | 说明 |
| --- | --- |
| `--source <id>` | `codex` / experimental `claude-code` / experimental `pi`；省略 = `codex` |
| `--root <dir>` | sessions root；也作 selector 默认 root |
| `--cwd <path>` | cwd selector shortcut |
| `--selector <json>` | 结构化范围 |
| `--db <path>` | 覆盖默认 db |
| `--best-effort` | 部分失败也写成功部分；不写 complete coverage |
| `--prune` | 执行 canonical Prune policy |
| `--cold-root <dir>` | 本轮额外 cold root（可重复） |
| `--json` | 输出 `SyncSummary` |

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" sync --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" sync --cwd <repo-cwd> --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" sync --root <sessions-root> --selector '{"kind":"cwd_date_range","cwd":"<repo-cwd>","fromDate":"<YYYY-MM-DD>","toDate":"<YYYY-MM-DD>"}' --json
```

Current inventories ingest plain `*.jsonl`; cold `*.jsonl.zst` is presence/raw-backup only, not a sync source。

## cold

Purpose：注册 cold raw root，供 prune 做 presence 判断。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" cold add --root <cold-root> --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" cold list --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" cold remove --root <cold-root> --json
```

- 配置位于 index 同目录的 `cold-roots.json`。
- Codex presence 识别 `rollout-*<uuid>.jsonl(.zst)` 文件名。
- cold 不解析正文，也不是默认同步源。

## find

Purpose：semantic recall；metadata projection 优先 `list` / read-only SQLite。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" find "cf tunnel" --json -n 5
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" find "xsearch" --cwd <repo-cwd> --sort ended --exclude-session <session-ref> --json -n 5
```

| option | 说明 |
| --- | --- |
| `--source <id|all>` | 省略 = all public |
| `--root` / `--cwd` / `--selector` | 范围 |
| `--sort relevance|ended|started` | 排序；何时使用见 canonical Sort policy |
| `--exclude-session <ref>` | 可重复 |
| `-n, --limit` | 返回条数 |

结果含 `sourceId`、`sessionRef`、`evidenceRead`。`SHLOG_STATS=0` 可关闭 text header 的扫描量/耗时注解。

## read-range

Purpose：围绕命中点读局部 index projection。

- 必填 `<sessionUuid|sessionRef>`。
- `--seq` / `--query` 至少一个；两者可同时使用。
- `--max-message-chars <n>`；`0` = 不做 display-time elision。
- 可选 `--source`；qualified `sessionRef` 与 flag 必须一致。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-range <sessionRef> --seq 12 --before 4 --after 8 --json
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-range <sessionRef> --query "IME" --before 4 --after 8 --json
```

## read-page

Purpose：顺序分页读 session 的 index projection。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" read-page <sessionRef> --offset 0 --limit 40 --json
```

Options：`--offset`、`--limit`、`--max-message-chars`、`--source`、`--json`。

## list

Purpose：列已索引 session，不做全文检索。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" list --cwd <repo-cwd> --sort ended --json
```

Options：`--source`、`--cwd`、`--since`、`--root`、`--selector`、`--sort ended|started|messages`、`-n`、`--db`、`--json`。

## stats

Purpose：索引统计。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" stats --json
```

Options：`--source`、`--db`、`--json`。

## 来源

- `src/cli.ts`, `src/env.ts`, `README.md`, `docs/ARCHITECTURE.md`
