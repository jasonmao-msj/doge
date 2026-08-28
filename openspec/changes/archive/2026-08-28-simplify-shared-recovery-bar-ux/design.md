## Context

- 上游：`docs/research/mossx-multi-cli-provider-session-foundation-design.md` §14.5.7 Recovery Exit Closure
- 已实现：`fix-shared-session-recovery-exit-closure`（后端 abandon/rebuild + 四按钮 UI）
- 痛点：四按钮认知负担；`window.confirm` 在 Tauri WebView 不可靠；Stop 常无 owner 仍可点

## Goals / Non-Goals

**Goals**

- 默认面：自动处理 + 跳过本轮
- 自定义弹窗（详情 / 跳过确认）
- 单行折叠 + 可展开高级
- 自动梯子复用现有 RPC，状态边仍经 settling

**Non-Goals**

- 改九态状态机枚举
- 自动 abandon
- 渠道炸失败分类整包重做

## 技术方案对比

| 方案 | 描述 | 取舍 |
|------|------|------|
| A. 仅改文案保留四按钮 | 低成本 | 不解决认知与 confirm 卡死 |
| B. 两主按钮 + 自动梯子 + 展开高级（采纳） | 产品默认简化，工程能力仍可达 | 实现与测试面中等 |
| C. 单一「修复」按钮黑盒 | 更简单 | 失败时无法跳过/高级干预，运维差 |

**采纳 B。**

## Decisions

1. **自动处理顺序**（单次点击串行，全程 busy）：
   1. `findRecoveryOwner`
   2. `clear` → unlock（probeNotAccepted + canonicalCommitted）
   3. `ambiguous` → held + 错误文案，停止梯子
   4. `attempt` → `recover_attempt`；active 则 reattach 并视为已出口；terminal/not-accepted → settle 解锁；unknown → 继续
   5. 仍为 attempt 且可 interrupt → `interrupt_turn`；terminal-committed → 解锁；否则 `runtimeReleased`
   6. 仍未解锁 → `rebuild_binding`（attempt 路径先 best-effort interrupt 已在 5；binding 直接 rebuild）
   7. rebuild 成功 → settleCancelled 解锁；失败 → held + 可操作 toast，「再试自动处理」

2. **跳过本轮**：ConfirmDialog → `abandon_unresolved_attempt(forceStop=true)`；binding-only 无 attempt 时等价 unlock；ambiguous fail-closed

3. **禁止** recovery 路径调用 `window.confirm` / `window.alert`

4. **停止请求**按钮：仅当最近解析 owner 为 attempt 时启用；否则 disabled + title 说明

5. **位置**：仍 `SharedSendStatusBar` 挂 Composer 底栏集群

## Risks / Trade-offs

- 自动 rebuild 对「仅需 abandon」场景可能过激 → 失败后明确引导跳过；不在 auto 内 abandon
- reattach active 后异步失败仍 held → 保持现有 reattach 错误处理

## Migration

- 无数据迁移；flag `sharedRecoveryExitV2` 仍控制 exit ladder；关闭时保留旧 Probe+Rebuild 双按钮（可选），默认 on 时走新 UX

## Open Questions

- 无（产品示意已确认）
