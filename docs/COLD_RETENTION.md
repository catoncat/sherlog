# Cold retention contract

## 目的

Sherlog 把 raw transcript 与 searchable projection 分开管理。用户可以压缩/移动旧 Codex JSONL，同时让 SQLite 中的历史 session 继续可查；cold registration 只保护显式 prune，不承担重建索引的职责。

Codex 自己会把闲置 rollout 压缩为同目录的 `rollout-*.jsonl.zst`。这不是 cold：被 sync 的 root（包括 `~/.codex/archived_sessions`）下的 `.jsonl.zst` 是 hot raw，`sync` 会解压索引（见 `docs/SOURCE_CONTRACTS.md` Codex storage forms）。本文的 cold root 指登记后只做 presence 的 archive root。

## 三层状态

1. **Hot raw**：被 `sync` 扫描的 transcript root，例如 `~/.codex/sessions`；Codex 的 plain `.jsonl` 与 `.jsonl.zst` 都在此层。
2. **Index projection**：`~/.local/state/shlog/index.sqlite`；`find`、`read-*`、`list`、`stats` 的唯一内容真相。
3. **Cold raw**：用户登记、但不作为 `--root` sync 的 archive root，例如逐文件 `rollout-*.jsonl.zst`。

v8 没有 metadata sidecar。cold registration 存在 SQLite `cold_roots` 表；legacy `cold-roots.json` 只可能由旧发布版留下，当前 native CLI 不创建或更新它，只在首次 v8 bootstrap/migration 时作为 one-shot import 输入。

## 核心不变量

- `cold add` 只登记一个 source/root，不扫描正文、不导入 session。
- `cold remove` 只取消登记，不删 archive 文件、不立即删 index row。
- normal `sync` 不会因为 hot raw 消失而自动删除已索引历史。
- 只有显式 `sync --prune` 才可能删除 projection。
- prune 只删除“当前 source 的 hot snapshot 不存在，并且 registered/ephemeral cold presence 也不存在”的 session。
- cold presence 只证明“保留 projection”，不证明 compressed file 可被 parser 重建。
- 一个 source 的 sync/prune 不删除另一个 source 的 row。
- cold-only session 在 v7 -> v8 migration 中必须从 stored projection 复制，不能依赖 hot raw 仍存在。

## 推荐归档流程

先确保目标 session 已进入 index：

```bash
shlog sync --json
shlog find "an exact archived clue" --json
shlog read-page codex:<session-id> --offset 0 --limit 20 --json
```

准备 archive 并逐文件压缩/移动。Sherlog 不负责这个文件操作；使用可回滚流程，并在删除 hot raw 前验证 archive 文件。

注册 archive root：

```bash
shlog cold add --root /Volumes/archive/codex --source codex --json
shlog cold list --source codex --json
```

最后才运行可选 prune：

```bash
shlog sync --source codex --prune --json
```

检查 summary：

- `removed`：本次真正删除的 projection 数；
- `retainedCold`：hot 已不在、但被 cold presence 保护的 session 数；
- `errors/errorDetails`：cold root walk 或其他 sync 错误；
- `coverage`：本次 selector 是否写入完整 proof。

## Cold 文件识别

当前 destructive cold-presence pruning 只支持 Codex。walker 不解压文件，从 filename 中提取末尾标准 UUID，并保守保留 rollout filename stem（分页段没有独立 UUID 时的身份）；支持：

```text
...<uuid>.jsonl
...<uuid>.jsonl.zst
```

它不会读取 zstd body，也不会验证 archive 内容与 indexed projection 相同。因此归档正确性由用户的 move/compress verification 保证。要让 archive 中的 rollout 可检索（包括从未索引过的），把该目录作为 `--root` sync；那时它是 hot root，`.jsonl.zst` 会被解压索引。

Claude Code 与 Pi adapter 可以正常 sync/query，但带 cold root 的 destructive prune 尚未定义可靠 identity mapping；这类操作 fail closed，而不是猜测并删除。

## Registered 与 ephemeral root

持久注册：

```bash
shlog cold add --root /archive/codex --source codex
shlog sync --source codex --prune
```

只对一次 sync 生效：

```bash
shlog sync --source codex --prune --cold-root /temporary/archive
```

`--cold-root` 可重复，不写 `cold_roots`。它与该 source 已注册 root 合并后参与本次 prune。

## v8 registration truth

v8 `cold_roots` key 是 `(source_id, root)`，`cold add` 幂等并保留原 `addedAt`。add/remove 与 sync 使用同一 writer lock 和 SQLite transaction；`cold list` 使用 query-only snapshot。

`cold add` 要求 root 已存在且是目录。`cold remove` 即使 root 已从磁盘消失也能按规范化路径取消登记。

CLI JSON 目前为兼容保留 `configPath` 字段；在 v8 中它指向 canonical legacy-fence 路径，cutover 后该路径是 symlink，不代表配置真相。实际 registrations 看 `roots`，持久真相看 SQLite `cold_roots`。

## Legacy v7 cutover

当前 native `cold add/remove` 从不把 registration 写回 legacy JSON：

- 没有 v8 时，`cold add` 创建 metadata-only v8，在一个 cutover transaction 中导入旧版本留下的全部 registrations 并执行 add；
- 没有 v8、但存在 legacy JSON 或已发布 fence 时，`cold remove` 同样创建 metadata-only v8，导入后再 remove；
- v8 与 legacy state 都不存在时，`cold remove` 返回 `removed=false`，不创建数据库。

旧版本留下的 regular JSON 是一次性输入。writer lock 内的 cutover protocol 是：

1. 严格读取 regular JSON、missing path 或 Sherlog 自有的已发布 fence；
2. preflight 在同目录创建永久的 private `0700` state directory：`cold-roots.json.v8-tombstone.<nonce>/`；若 regular JSON 存在，在其中创建指向同一 inode 的 hard-link backup `cold-roots.v7.json`，并写入 transition marker。copy migration 会先 build/verify/seal v8 staging 再做此 preflight；sync/cold bootstrap 则先 preflight，再准备 projection/transaction；
3. v8 transaction/staging 准备完成且输入重新验证后，先发布 filesystem fence：canonical `cold-roots.json` 变成只含一个相对路径组件的 symlink，指向该 state directory；若起初 missing，则用 create-if-absent symlink，期间出现新 JSON 会让 cutover 失败而不是覆盖它；
4. fence 发布后才 commit/publish v8，随后重新确认 symlink、state directory 与 recovery backup。v8 之后只读/写 SQLite `cold_roots`，按旧路径重新打开的 TypeScript writer 会因 symlink 指向目录而 fail closed。

fence 只能线性化 pathname，不能收回发布前已被旧进程打开的 file descriptor。该 FD 甚至可能在 post-check 后继续写同 inode 的 hard-link backup；用户态无法把这个跨进程窗口完全线性化。backup 会永久保留该 inode 作为恢复输入与证据；若命令报告 fence/cutover error，先停止旧 writer，再重试 native writer。不要删除或替换 canonical symlink、target directory、marker 或 `cold-roots.v7.json`，即使数据库发布失败或恢复为 v7 也一样。

## Prune 判定

对当前 selector/source 的每个 indexed session：

```text
present in selected hot snapshot?
  yes -> keep
  no  -> native id present under registered or --cold-root archive?
           yes -> keep and retainedCold += 1
           no  -> delete only when --prune was explicit
```

默认 sync 不进入最后的 delete 分支。filtered/unsupported raw record 也不会被当成可随便删除的不存在记录；sync 必须先建立可信 snapshot/projection proof。

## 常见操作

列出全部 source registrations：

```bash
shlog cold list --json
```

取消 registration，但暂不删 projection：

```bash
shlog cold remove --root /archive/codex --source codex --json
```

确认后再 prune：

```bash
shlog sync --source codex --prune --json
```

恢复误移走的 hot raw 不需要特殊命令：把验证过的 plain JSONL 或 Codex `rollout-*.jsonl.zst` 放回正确 source root（或对其所在目录用 `--root`），再运行同范围 `sync`。只在 registered cold root 中的文件不会被解压重建。

## Failure handling

- cold root 不存在/不是目录：`cold add` 返回 `invalid_cold_root`，不写状态。
- v8 index 不兼容：cold writer 返回 schema/index error，不创建替代真相源。
- writer lock 冲突：等待或返回 lock error，不绕过 SQLite transaction。
- cold walk error：destructive prune fail closed；不要把不可读 archive 当“不存在”。
- `--best-effort` 有 per-file errors：成功 projection 可以提交，但 complete coverage 不会被伪造。
- 旧版本留下的 legacy config malformed：native writer 在 fence/数据库发布前失败；保留原状态，修复输入后重试。

## Agent-side raw fallback

当 `read-*` projection 明确缺少完整 tool call、patch、长代码或原始事件时，可以先用 Sherlog 定位 session，再对相关 archive 文件做有限取证：

```bash
shlog cold list --json
zstd -d /archive/.../rollout-...jsonl.zst -o /tmp/sherlog-session.jsonl
rg "exact clue" /tmp/sherlog-session.jsonl
```

这是 agent-side fallback，不是 Sherlog normal retrieval path，也不改变 privacy-filtered index contract。
