# Cold Retention：冷存一等语义（设计）

状态：**已实现（checkout）** 2026-07-13  
用户拍板：**C — 改 prune 语义，冷迁不算 missing**  
已否决：用确认 flag / 拦截 library API 当主方案

实现入口：`src/cold-roots.ts`、`src/db/coverage-store.ts`、`src/indexer.ts`、`src/cli.ts` cold 子命令。  
未 npm release 前，全局 `shlog` 可能仍是旧行为；验证用 `npm run shlog --`。

---

## 1. 用人话：要解决什么

你要同时：

1. 省硬盘  
2. Codex 热目录变瘦、启动更快  
3. **Sherlog 历史还能查**

你已经在做的事是对的：

- 旧 raw 从 `~/.codex/sessions` 搬到 `~/.codex/archived_sessions`
- 再压成 `rollout-*.jsonl.zst`（可 `rg -z`）
- 检索靠索引；普通 `sync` 不会因为源文件搬家就删历史

**真正错的是 prune 的世界观：**

> 今天 prune 认为：热目录里见不到 = 该从索引删掉。

冷迁之后，“热目录见不到”是**正常状态**，不是“用户不要了”。  
所以要改的是：

> **冷存里还在的会话 = retained（保留），不是 missing（可删）。**

不是“教 agent 别 prune”，也不是“拦自己的 API”。  
是让 **prune 在有冷存时做对事**。

---

## 2. 三层存储（产品模型）

| 层 | 是什么 | 典型位置 | 干什么 |
| --- | --- | --- | --- |
| L0 hot | Codex 正在用的 raw | `~/.codex/sessions` | 默认同步源；保持精简 |
| L1 index | Sherlog SQLite | `~/.local/state/shlog/index.sqlite` | **检索真相源** |
| L2 cold | 归档 raw（可压缩） | `~/.codex/archived_sessions/.../*.jsonl.zst` | 省空间；证明“还在” |
| L3 backup | 整包 tar 等 | 任意 | 离线备份；**不**进 prune 语义 |

官方推荐 L2 布局（与你本机一致）：

```text
~/.codex/archived_sessions/YYYY/MM/DD/rollout-....jsonl.zst
```

- 逐文件 zst：可 `rg -z`  
- 整月 `tar.zst`：只当 L3，**不**承诺参与 cold 识别 / sync

---

## 3. 状态机（会话在索引里的产品语义）

对已索引 session：

```text
        仍在 hot snapshot
              │
              ▼
            hot  ────────── 默认同步更新内容
              │
              │ 用户冷迁（移出 hot / 压成 zst）
              ▼
            cold ────────── 索引保留；find/read 仍可用
              │
              │ 冷存也没了，且用户真要丢掉
              ▼
           missing ─────── 仅此时 prune 才删索引行
```

| 状态 | 热目录 | 已注册冷根下有对应物 | prune 时 |
| --- | --- | --- | --- |
| hot | 有 | 无所谓 | 保留（本来就在 retained set） |
| cold | 无 | **有**（`.jsonl` 或 `.jsonl.zst`） | **保留** |
| missing | 无 | 无 | 可删 |

**默认 `sync`（不 prune）**：继续今天的 retain——源消失也不删。  
**`sync --prune`**：只删 **missing**，不删 **cold**。

---

## 4. 为什么不是“拦 prune”

| 旧补丁思路 | 问题 |
| --- | --- |
| 裸 `--prune` 失败，要确认 flag | 承认 prune 语义是错的，却用门槛掩盖 |
| library 也强制确认 | 自己挡自己的 API，味道不对 |
| 只改 skill 文案 | agent 仍可能 prune |

C 的目标：

```text
prune(hot_snapshot) ∩ retain(cold_presence) 
→ 只丢掉真正两边都没有的行
```

有冷存注册且冷文件还在时，**即使用了 `--prune` 也不该误伤**。

---

## 5. 最小 C（本轮要做的）

一句话：

> **注册 cold root → prune 时用“冷目录里是否还在”扩 retained set → 不重解析全文。**

### 5.1 用户可见命令（建议）

```bash
# 注册冷根（只记路径 + 可做一次 presence 扫描元数据；不重索引正文）
shlog cold add --root ~/.codex/archived_sessions

# 查看已注册冷根
shlog cold list

# 取消注册（不删冷文件、不删索引）
shlog cold remove --root ~/.codex/archived_sessions
```

也可在单次 sync 上临时带上（实现二选一或都要）：

```bash
shlog sync --cold-root ~/.codex/archived_sessions --prune
```

**官方冷迁流程：**

```text
1. shlog sync                    # 确保要保留的历史已进索引
2. 验证 find / read-page
3. 搬家到 archived_sessions
4. 可选：逐文件 zstd
5. shlog cold add --root ~/.codex/archived_sessions
6. 之后普通 sync / 甚至 sync --prune：冷会话仍在索引里
```

### 5.2 prune 新算法（核心）

今天（错误对冷迁）：

```text
retained = 本轮 hot snapshot 里还存在的 file_path
删除 selector 内所有 file_path ∉ retained
```

C 之后：

```text
hot_retained   = 本轮 hot snapshot 的 file_path 集合
cold_present   = 在已注册 cold root 下，能对应到 native_session_id 的会话
                 （识别 *.jsonl 与 *.jsonl.zst，不要求解压解析正文）
retained       = hot_retained 对应的 session
                 ∪ cold_present 的 session
删除           = selector 范围内 ∧ 不在 retained
```

匹配规则（Codex 现实）：

- 冷文件名形如：`rollout-<ts>-<uuid>.jsonl` / `.jsonl.zst`
- 用文件名中的 **uuid** 对齐 `sessions.native_session_id` / `session_uuid`
- **不**要求 `file_path` 仍指向冷路径（冷迁后库里常仍是旧 hot 路径，这是现状，本轮不强制改写）

其他 source（claude-code / pi）：

- 第一刀可只做 **Codex 文件名 uuid 约定**
- 或：cold root 下按各 adapter 声明的 `coldPresenceId(path) -> native_session_id | null`
- 未知命名 → 不认作 cold（保守：宁可当 missing，也不误保留脏名）  
  注意：这与“防误删”相反方向；对 Codex 主流路径必须命中。非 Codex 可第二刀。

### 5.3 不碰什么

| 不做 | 原因 |
| --- | --- |
| 默认每次 sync 扫冷根全文重解析 | 慢、混语义 |
| 默认改写所有 `file_path` 为冷路径 | 迁移面大；read 不依赖 raw |
| 让 Codex 自己读 zst | 超出 Sherlog |
| 确认 flag / 拦 library | 用户已否决为主方案 |
| ranking / eval 大改 | 无关 |

### 5.4 与“能读 zst 再 sync”的关系

| 能力 | 本轮 C | 以后可开 |
| --- | --- | --- |
| 冷文件 **在不在**（presence） | ✅ 要做 |  |
| 从 zst **重建索引正文** | ❌ | 灾难恢复 / rehydrate issue |
| 默认 sync root 含 archived | ❌ | 永不默认；仅显式 root |

Presence ≠ rehydrate。本轮只解决 **误删**，不解决 **丢索引后从 zst 重建**。

---

## 6. 数据放哪（最小实体）

优先 **少表**：

**方案 R1（推荐）**：`SHLOG_DATA_DIR/cold-roots.json`（或 sqlite `meta`/`cold_roots` 表）

```json
{
  "version": 1,
  "roots": [
    {
      "sourceId": "codex",
      "root": "/Users/you/.codex/archived_sessions",
      "addedAt": "2026-07-13T..."
    }
  ]
}
```

- `cold add/list/remove` 读写这份配置  
- `sync --prune` 读取配置，算 `cold_present`  
- 不把 cold 状态冗余写进每一行 session（第一刀不必 `status=cold` 列）

**可选增强（第二刀）**：

- prune 摘要增加：`removed` / `retainedCold`  
- `status` 显示 cold roots 与“索引行多于 hot 文件”是预期

**不推荐第一刀**：给每行 session 加 `lifecycle` 枚举并在每次冷迁改写——运维成本高，且冷迁常在 Sherlog 外发生。

---

## 7. CLI / API 变更表

| 面 | 变更 | 兼容 |
| --- | --- | --- |
| `shlog cold add/list/remove` | 新子命令 | 新 |
| `sync --cold-root <dir>` | 可选；本轮可并入 cold add 持久化，或临时追加扫描根 | 新 |
| `sync --prune` | **语义收紧**：不删 cold-present | 行为变化：以前会删的冷迁行，现在保留（这是目标，不是回归） |
| 默认 `sync` | 不变（仍 retain） | 兼容 |
| `syncSessions({ prune })` | prune 路径内部使用 cold registry；**无**确认参数 | 库语义与 CLI 一致，不是互拦 |
| help / docs / skill | 冷迁官方路径；prune = 删 missing，不是删 cold | 文案 |
| 错误码 | 冷根不存在等：`invalid_cold_root` 之类 | 新，局部 |

**刻意不做：**

- `--i-know-this-deletes-history`
- `SHLOG_ALLOW_PRUNE`
- library `allowHistoryDeletion`

若仍有人在**未注册 cold**时 prune，冷迁行仍可能被删——那是“没告诉 Sherlog 冷根在哪”，应用 **cold add** 修流程，而不是确认 flag。  
skill 写清：冷迁后必须 `cold add`。

---

## 8. 实现切片（1–2 个 tracer）

### Bullet 1 — Cold presence + prune 语义

1. cold roots 存储（json 或 sqlite meta）  
2. `listColdPresentSessionIds(sourceId, roots) -> Set<native_session_id>`  
   - walk 文件；认 `.jsonl` / `.jsonl.zst`  
   - Codex：从文件名抽 uuid  
3. `deleteSessionsForSelectorExcept...` 的调用侧：  
   retained = hot file paths 对应 session **或** native id ∈ cold_present  
4. 测试：
   - 索引两会话 → 一个移到 cold root 并可选 `.zst` → 注册 cold → `prune` → **removed=0 对冷的那条**；热还在的保留；两边都没有的才删  
   - 未注册 cold → prune 行为与今天一致（仍删“热里没了”的）——用测试钉住，docs 强调要 register  
   - 默认 sync 仍 retain，与 cold 无关  

### Bullet 2 — CLI + docs + skill

1. `cold add|list|remove`  
2. USAGE / ARCHITECTURE / INDEX_COVERAGE：三层 + 官方冷迁步骤  
3. skill：冷迁后 `cold add`；不要把 prune 当维护默认；说明 prune 在已注册 cold 下是安全的（不误伤 cold）  
4. failure-cookbook：冷迁后检索仍走 index；若误 prune 且未 register，补 `cold add` **救不回已删索引**（需从冷 raw rehydrate——属后续）

---

## 9. 验收（行为）

| Given | When | Then |
| --- | --- | --- |
| 已索引，raw 已进 cold root 并 `cold add` | 普通 sync / find / read | 历史仍可查 |
| 同上 | `sync --prune` | **不删** cold-present 会话；`removed` 不含它们 |
| 热与冷都没有的会话 | `sync --prune` | 删除（真 missing） |
| 冷迁但 **没** `cold add` | `sync --prune` | 仍可能删（与旧行为一致）——docs/skill 要求 add |
| 新用户读文档 | 想省空间不丢 Sherlog | 看到：sync → 搬家 → zstd → **cold add**；不是“永远别 prune”玄学 |

---

## 10. 风险（诚实）

| 风险 | 处理 |
| --- | --- |
| 忘记 `cold add` | 流程写进 skill/USAGE；可考虑 status 提示“hot 少了很多文件但 index 仍多，若已归档请 cold add” |
| uuid 不在文件名 | Codex 主流有；其他 source 第二刀 |
| 大 cold 树 walk 慢 | presence 可缓存 mtime/fingerprint；第一刀可接受一次 prune 时扫描 |
| 误以为 zst 已能 sync 重建 | 文档明确：presence ≠ rehydrate |
| 把整包 tar 当 cold root | 文档：不支持；要逐文件 |

---

## 11. 与旧 A/B/C 标签对齐

| 旧标签 | 含义 | 本轮 |
| --- | --- | --- |
| 旧 A 确认护栏 | 拦裸 prune | **不做主方案**（用户否决） |
| 旧 B cold 一等 | 状态/冷根 | **≈ 本轮做的事**（你口头选的“C”） |
| 旧 C zst 全文可读 | rehydrate | **不做**；仅 presence 认 `.zst` |

你选的「C」在对话里是：**改语义，冷≠missing**。  
实现上对应旧文档的 **B 最小版 + 认 zst 存在性**，不是全文解压同步。

---

## 12. 授权边界

- 默认仍停在设计评审，除非你说 **继续实现**。  
- Mainline intent：`int_88c9c726`  
- 实现时：默认 retain 不变；prune 只变聪明，不变成默认。

---

## 13. 请你确认的一句

实现将按：

1. `shlog cold add/list/remove`  
2. prune 时合并 cold presence（含 `.jsonl.zst`）  
3. 不写确认 flag、不拦 library  
4. 不做 zst 全文 rehydrate  

若同意，回复 **继续实现**。  
若希望 **无 cold add、约定默认扫描 `~/.codex/archived_sessions`**，也可以说，我会改成“约定优先、可覆盖”。
