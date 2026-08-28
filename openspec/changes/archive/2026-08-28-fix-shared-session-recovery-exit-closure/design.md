## Context

Shared V2 已实现九态状态机、`recovery-required` 线性锁、Probe/Rebuild 命令，以及 Runtime `owns_attempt` 时对 rebuild 的 fail-closed 拒绝。基石 §14.5.7 已补「出口阶梯」设计；代码侧 UI 仍只有 Probe+重建，导致 `recovery-active… Probe/Stop before rebuild` 死循环。

上游权威：`docs/research/mossx-multi-cli-provider-session-foundation-design.md` §14.5 / §14.5.7。  
实施计划：`docs/plans/2026-08-04-shared-session-recovery-exit-closure.md`。

## Goals / Non-Goals

**Goals**

- 可完成出口：Probe / Stop / Stop并重建 / Abandon。
- 分类正确：纯 unavailable ≠ recovery。
- 不双发：所有权与 durable terminal 先于解锁。
- 可解释：i18n + 可解析错误码。

**Non-Goals**

- 取消 linear lock / 自动 failover / Queue-Branch redesign。
- S5 归档、S6 拖拽。

## Decisions

### D1 — Rebuild 策略 B（Stop 再 Rebuild）

当 `findRecoveryOwner` 为 attempt 且可能被 Runtime own 时，Rebuild 路径 **best-effort interrupt** 后再调用 `rebuild_binding`。interrupt 失败不假装成功；保留 recovery-required 并引导放弃。

### D2 — Abandon 新命令

`shared_session_v2_abandon_unresolved_attempt`：

- 解析唯一 unresolved attempt（或入参 attemptId）。
- Runtime still owns → 默认拒绝 `recovery-active-requires-stop`；`forceStop=true` 时先 interrupt 再 settle。
- 结算为 durable cancelled terminal（`stop_reason=user-abandon-unresolved`）。
- 清理 coordinator attempt；若 binding 无更多 unresolved 且 provisioning=recovery-required，回 prepared/ready。
- 幂等：已 terminal-committed 则返回已提交状态。

### D3 — 不扩展九态

Abandon/Rebuild 成功只派发既有事件：`commitCancelled` | `probeNotAccepted` | `probeTerminalRun` + `canonicalCommitted`。禁止 `recovery-required → idle` 直跳。

### D4 — 错误契约

保留人类可读 `Err(String)` 前缀兼容：

- `recovery-active:` / `recovery-active-requires-stop:` / `recovery-owner-ambiguous:`

前端按前缀映射 i18n；详情折叠展示 raw。

### D5 — 分类纠偏

- begin 返回 `target-unavailable` → `targetUnavailable`（已有）。
- prepare 前失败 → idle（已有）。
- begin RPC throw：若 message 可证明 **无 durable attempt 且明确 target-unavailable**，走 targetUnavailable；否则保持 recovery（Tx1 不确定）。
- `isKnownFailedTerminalError` 扩展可识别的 typed unavailable/rejection，禁止抬升 recovery。

### D6 — 融合 P1

`MessageQueue` / fuse 入口：`canFuse=false` 时 title 使用原因文案（无活跃 turn / 能力不足 / Shared 恢复中 / 处理中断网关类错误映射到可操作说明）。不改变 fuse 可用性判定核心，只补解释。

### D7 — Feature flag

`sharedRecoveryExitV2` 默认 **on**（localStorage/env 可关）。关闭时 UI 回退 Probe+Rebuild 双按钮（旧行为），abandon 命令仍可存在但不暴露主按钮。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| Abandon 误杀在跑 turn | 确认框 + active 强警告 + 默认要求先 Stop |
| Interrupt 引擎不一致 | 能力不足时禁用 Stop，主推 Abandon |
| 分类过宽导致该锁不锁 | 单测钉 ambiguous 仍 recovery |
| 迟到 ACK 重锁 | Abandon/Rebuild 后 terminal 只 absorb，不二次锁同 attempt |

## Migration Plan

1. 落地命令 + FE 阶梯 + i18n。
2. 默认开启 flag。
3. 回滚：关 flag 隐藏新按钮。

## Open Questions

无（产品决策已由用户授权：P0+P1、策略 B、含 Abandon、不提交）。
