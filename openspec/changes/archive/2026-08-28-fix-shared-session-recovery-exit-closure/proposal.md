## Why

Shared Session 在 fail-closed 恢复语义下会进入 `recovery-required` 并锁定整会话，这是正确的防双发合同；但当前出口不完整：`target-unavailable` 与 recovery 可能混淆、Rebuild 在 Runtime 仍 own attempt 时被硬拒绝且 UI 不先 Stop、缺少 durable「放弃本轮」。结果是用户会话变成消耗品，直接打掉 Shared 采用率。

## What Changes

- 严格分流 `target-unavailable` vs `recovery-required`：纯目标不可用不锁整会话。
- Recovery Exit Ladder：检查状态 → 停止投递 → **停止并重建** → **放弃本轮（durable）**。
- Rebuild 采用策略 B：Runtime own attempt 时先 interrupt，再 rebuild；拒绝时给出可操作文案。
- 新增 `shared_session_v2_abandon_unresolved_attempt`（或等价组合）落 durable cancel，重启不复活锁。
- 结构化/可解析 recovery 错误码 + i18n（至少 zh/en 与 locale parity）。
- P1：融合按钮在不可用时展示明确原因（网关/能力/会话状态），避免“点了没反应”。

## 目标与边界

- **目标**：保留 fail-closed 防双发，补齐可完成恢复出口（completable exit ≠ fail-open）。
- **边界**：不取消 linear recovery 锁；不自动 blind retry / 自动 failover；不引入 Queue/Branch 放行其他 Binding 聊天；不改 S5 归档 / S6 拖拽。

## 非目标

- 取消 `recovery-required` 整会话锁定。
- 静默 idle 解锁（无 durable terminal evidence）。
- 在 Runtime 仍 own 时强行 archive/rebuild。
- 项目归档、标题栏拖拽热区。

## Capabilities

### New Capabilities

- `shared-session-recovery-exit`: Shared recovery 出口阶梯、Stop/Stop并重建/Abandon、错误可解释性与迟到证据吸收合同。

### Modified Capabilities

- `shared-send-pipeline`: 失败分类与 recovery/rebuild 前置条件对齐 exit ladder；target-unavailable 不得抬升为 recovery。

## Impact

- Frontend: `SharedSendStatusBar.tsx`、`sendSharedSessionTurnV2.ts`、`sharedSessions.ts`、sharedSend i18n、可选 MessageQueue fuse 文案。
- Backend: `shared_session_v2.rs`、`command_registry.rs`、coordinator 组合（不改所有权模型）。
- Tests: FE unit + Rust recovery-active / abandon / stop-then-rebuild。
- Docs: 基石 §14.5.7 已有设计；本 change 实现之；plan `docs/plans/2026-08-04-shared-session-recovery-exit-closure.md`。

## 技术方案对比

| 选项 | 描述 | 取舍 |
|------|------|------|
| A. 仅 toast 引导先 Probe | 改动最小 | 出口仍不闭环，不解决 P0 |
| **B. Stop 并重建 + Abandon（推荐）** | 先 interrupt 再 rebuild；提供 durable 放弃 | 满足可完成出口，保留 fail-closed |
| C. 按钮严格分离（Rebuild disabled until !owns） | 呈现清晰 | 用户仍缺一键路径，需多次点击 |

采用 **B**，呈现层可并用 C（Stop 后才启用纯 Rebuild）。

## 验收标准

1. 纯 target 不可用 → `target-unavailable`，可换 Target 再发，不整会话 recovery。
2. recovery 下「停止并重建」≤3 次明确点击可达 idle 或 reattach running。
3. 「放弃本轮」后 durable cancel，重启不复活同一 attempt 锁。
4. 任意路径不双发 / 不盲建第二个 Binding。
5. 错误文案说明为何锁、下一步点谁；禁止仅 raw `recovery-active:…`。
6. 融合不可用时 title/文案说明原因（P1）。
