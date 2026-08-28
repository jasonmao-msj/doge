## Why

Shared CLI 在渠道 503 / 切换供应商失败 / 同 Binding 多次「继续」之后，Runtime 经常只收到本轮短指令（如「继续」），**丢失 Shared Canonical 中的原任务**。  
`fix-shared-session-recovery-exit-closure` 已闭环锁死出口；本 change 针对 **正交的 context 信任与空交接**问题。

> **校准（2026-08-04 二次代码复核）**：初版「凡 zero-transfer 即全量 rematerialize」**不能**作为最终方案——会破坏健康路径的 no-replay 与 A-B-A destination-owned 合同。根因是 **在 native 不可信时仍假设 history 已在 native 内**。

## What Changes

- 为每个 Shared Binding 增加 **native context trust** 状态（`trusted` / `dirty`，落在既有 `provisioning_json` 扩展字段，无 schema 迁移）。
- 在明确失败/失联信号上将 binding 标为 **dirty**（503/provider-rejected/native-session-not-found/recovery/rebuild）。
- `prepare_delivery`：**仅当** `zero-transfer && needs-history && dirty` 时强制 rematerialize（`from_sequence=0` + 投影忽略 destination-owned）。
- **trusted** 时保持现有 no-replay：允许 zero-transfer，只发用户短句（依赖 native resume）——这是有意设计，不是 bug。
- rematerialize 成功并完成 context accept（或整轮 completed）后将 trust 清回 **trusted**。
- 可观测：`rematerialized`、`nativeContextTrust`、typed `empty-context-handoff`（rematerialize 仍空）。
- 测试：dirty 后继续含原任务；trusted 健康路径不强制全量；A-B-A destination-owned 不破。

## 目标与边界

### 目标

| ID | 目标 | 可测定义 |
|----|------|----------|
| G1 | 失败后续接保上下文 | binding dirty 后短「继续」→ Runtime 入站含原任务（prompt-prefix/import）或 fail-closed |
| G2 | 健康路径不恶化 | trusted + 可 resume 时不强制每轮全量注入 |
| G3 | 保留 A-B-A 去重 | 回切旧 binding 且 trusted 时仍可 destination-owned 省略本 binding 旧历史 |
| G4 | 不双投（trusted） | 同 native 可信时不重复整包 inject |
| G5 | 与 recovery 正交 | 不改 recovery 锁语义；可与 abandon/rebuild 协作（rebuild 清空身份并 dirty） |

### 边界

- Shared Session V2 context compile / prepare_delivery / dispatch / terminal settlement 写 trust。
- 不重做幕布 Canonical projection（「UI 读不全历史」若仍存在，另案）。
- 不修网关 503 容量本身。

## 非目标

| 项 | 原因 |
|----|------|
| 取消 recovery 整会话锁 / silent idle | 防双发合同 |
| 每轮无条件全量 prompt-prefix | 破坏 no-replay、爆 token、破坏 A-B-A |
| 自动换 Provider failover | 产品非目标 |
| 幕布 history UI 投影缺陷 | 与 Runtime 交接正交；需独立证据再开 change |
| Canonical 里根本没有原任务时「变出」正文 | 无法从零创造；仅能 fail-closed / 提示 |

## 问题覆盖矩阵（诚实结论）

| 图1 / 社区症状 | 本 change | 说明 |
|----------------|-----------|------|
| 切换失败锁死无法恢复 | ❌ 不在本 change | 已由 `fix-shared-session-recovery-exit-closure` 覆盖 |
| 同 Binding 503 后继续只剩「继续」 | ✅ | dirty + rematerialize |
| 换 Target 后首轮丢上下文 | △ 通常已有全量；若错误 trusted 空包 | dirty 信号覆盖失败后；健康换绑靠 empty accepted |
| destination-owned 全吞 + native 已死 | ✅ | dirty 时投影不信任 owned |
| 健康多轮短继续 | ✅ 不改坏 | trusted 保持 zero-transfer |
| 幕布「读不全 shared 记录」 | ❌ 另案 | history loader / projection |
| 原任务从未写入 Shared Event Log | ❌ 无法修 | 只能错误提示 |

**结论：不能宣称「一张提案修全部」**；本 change 修 **Runtime 上下文交接在 native 失信后的空交接**，与 recovery 出口拼成完整 P0。

## Capabilities

### New Capabilities

- `shared-context-resume-integrity`：binding native context trust、dirty 触发 rematerialize、空交接守卫与可观测合同。

### Modified Capabilities

- `shared-context-delivery`：accepted no-replay **仅在 trusted** 时成立；dirty 允许新 package 全量再交付。
- `shared-context-compiler`：rematerialize 编译可关闭 destination-owned（调用方传 `destination_native_session_id=None`）。
- `shared-context-package`：rematerialize package 身份与审计。
- `shared-send-pipeline`：prepare 路径 trust 感知与错误映射。

## Impact

| 层 | 触点 |
|----|------|
| Backend | `shared_session_v2.rs`（terminal → dirty、prepare rematerialize、accept → trusted）、`shared_context/*` helpers |
| Frontend | 可选 i18n / `empty-context-handoff` 映射 |
| Tests | Rust unit + `tests/shared_context.rs` |
| Schema | 无新表；`provisioning_json` 增字段 `nativeContextTrust` |

## 技术方案对比

| 选项 | 描述 | 问题 | 取舍 |
|------|------|------|------|
| A. 凡 zero-transfer 就 rematerialize | 初版 | 健康路径每轮全量；破坏 A-B-A | **否决** |
| **B. Trust dirty bit + 条件 rematerialize** | 失败标 dirty，仅 dirty 时空包才全量 | 需正确打 dirty 点 | **采用** |
| C. 每次失败强制 rebuild | 粗暴清 native | UX 重、丢 live owner | 否（已有显式 rebuild） |
| D. 仅 toast 引导 rebuild | 最小改动 | 默认路径仍丢上下文 | 否 |

## 验收标准

1. **脏后续接**：seed 原任务 → accept → 模拟 503 failed commit 且 binding dirty → 再发「继续」→ package/outbound **含**原任务文本。
2. **健康路径**：trusted 多轮短继续 → **不**强制 rematerialize（zero-transfer 允许）。
3. **A-B-A**：A 完成 → B 完成 → 回 A 且 trusted → A 历史仍可 destination-owned 省略（既有测试不破）。
4. **rematerialize 仍空 + needs-history** → `empty-context-handoff`，不静默 `no-context-transfer-required`。
5. rebuild 后 trust 为 dirty 或无 native；首轮非空历史 MUST 有 transfer payload。
6. 单测 + `openspec validate` 通过。

## 与 recovery-exit 的关系

```text
recovery-exit-closure  →  锁得住也解得开
resume-integrity       →  native 失信后继续仍带得上 Canonical 上下文
二者一起 ≈ 图1 灾难主链的工程侧闭环
≠ 网关 503 本身 / UI projection 另案
```
