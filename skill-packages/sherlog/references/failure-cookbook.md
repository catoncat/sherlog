# Failure Cookbook

Apply `SKILL.md` **Canonical policy**. This file maps failures to recovery actions; it does not redefine sort / coverage / cold / prune policy.

## 快速表

| 症状 | 先跑 | 处理 |
| --- | --- | --- |
| `find` 有结果且仍返回 coverage `nextAction` | 读 `nextAction` | 按 canonical Coverage policy 判断是否需要完整结论与 scoped sync |
| `find` 零结果但用户坚持存在 | `status --source <id> --cwd <repo-cwd> --json` 或同 selector status | coverage 不足才 sync；同范围重查 |
| `sync` 非零 + per-file errors | 原范围 `sync ... --json 2>&1` | 看 `errorDetails[]`；仅用户接受 partial 时 `--best-effort` |
| 旧 CLI `selector_required` | 更新 CLI，或补 `--root/--cwd/--selector` | 当前裸 `sync` 可 first-install bootstrap |
| `index_unavailable` | bare `sync` 或 scoped `sync --cwd <repo-cwd>` | 索引未建立 |
| `index_schema_upgrade_required` | 原范围 `sync --source codex ...` | 只读命令不迁移 |
| `session_not_found` | 看 `nextAction` + 同 source `status` | 当前 index 无此 ref；可能未同步 / source 错 / coverage 问题 |
| 冷迁后担心历史丢了 | `find/list/read-*` | 默认 retain；确认 cold 已注册。完整 raw 细节走 progressive raw fallback |
| `database is locked` | 重试一次 | 仍忙则跳过 `stats`，稍后重试读命令 |
| 同主题多 uuid | `find -n 10 --json` | 按 `startedAt` / `cwd` / `matchCount` 选，再执行 `evidenceRead` |
| metadata 问题却 broad find/status | 只读 SQLite + `read-*` | 标 `skill-guidance-issue`，改用 metadata primitive |
| CJK 零结果 | 换词 | ≥2 字中文、英文标识符、或缩 selector |
| `unsupported_source` | 修正 source id | public: `codex` / experimental `claude-code` / `pi` |
| 找不到 db | `stats --json` 看 `dbPath` | 必要时 `--db` |

## Find zero results but user insists it exists

1. 看 `find --json` / `list --json` 的 `nextAction`。
2. 检查同一目标范围：

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" status --source codex --cwd <repo-cwd> --json
```

3. 按 canonical Coverage policy query 或 scoped sync。
4. 保持同一 selector 重试查询，再判断是否真无结果。

## Sync non-zero with per-file errors

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" sync --root <sessions-root> --json 2>&1
```

- 默认严格：先判断坏 JSONL / 权限 / 解析失败。
- 仅用户接受 partial index 时用 `--best-effort`；它不写 complete coverage。
- 冷迁顺序：先 sync 建索引 → 搬家/可选逐文件 zstd → `cold add --root <cold-root>` → 普通 sync。
- 整包 tar.zst 不是 cold presence 源；逐文件 cold zst 也不会被 sync 重建。

## index_unavailable

`--json` 返回 `error.code = index_unavailable` 与 bootstrap `nextAction`。

```bash
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" sync
# or scoped:
"${SHLOG_BIN:-${CXS_BIN:-shlog}}" sync --cwd <repo-cwd>
```

## index_schema_upgrade_required

用同一目标范围跑 `sync --source codex --root/--cwd/--selector`；不要用只读 SQLite 手写迁移。

## Database is locked or SQLITE_BUSY

重试一次。纯读取不必先 `stats`；刚 `sync` 过则稍后再试。

## Slow or over-broad Sherlog use

症状：metadata-only 问题却 broad `status` + broad `find`。

处理：

1. 标 `skill-guidance-issue`。
2. 只读 SQLite metadata projection（见 advanced-queries）。
3. `read-*` 验证最终候选。

## --json error shape 速查

| 命令 | 出口 | 形状要点 |
| --- | --- | --- |
| 旧 `sync` 缺 selector | stdout | `selector_required` |
| `sync` invalid selector | stdout | `invalid_selector` |
| `sync` per-file 错 | stderr | `SyncSummary.errorDetails[]` |
| `sync` Codex soft stale | stdout | success + `source_content_changed` + `recommendedAction=query` |
| `sync` active source deferred | stdout | success + `coverage.written=false` + `recommendedAction=sync` |
| `sync` 锁超时 | stderr | `{ "error": <string> }` |
| `status` invalid selector | stdout | `invalid_selector` |
| find/read/list/stats 无 index | stdout | `index_unavailable` + `nextAction` |
| 旧 schema | stdout | `index_schema_upgrade_required` |
| read 未索引 session | stdout | `session_not_found` + `nextAction` |
| 未知 source | stdout | `unsupported_source` |

字段细节见 `json-schema.md`。

## Schema drift

代码真相：`src/types.ts`、`src/cli.ts`。变更顺序：references → `SKILL.md` → 更新 `skill-sync` 标记。

## 来源

- `src/cli.ts`, `src/types.ts`, `src/env.ts`, `src/query.ts`
