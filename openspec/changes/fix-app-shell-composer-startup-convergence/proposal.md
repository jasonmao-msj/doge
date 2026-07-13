## Why

生产包冷启动仍可能在 `AppShell` 首屏恢复期间触发 React #185 `Maximum update depth exceeded`。最新 minified stack 已收敛到 `AppShell`，且问题发生在 app settings readiness、pending thread 恢复与 canonical identity 迁移并发的窗口，说明既有幂等修复仍未切断 selection cache 对 reload effect 的自反馈依赖。

## What Changes

- 让 composer selection reload 读取同步 cache snapshot，而不是订阅并回写同一个 React cache state。
- 保证 `pending -> canonical` selection 迁移先于 canonical thread reload 完成，避免启动期先清空再恢复。
- 增加 StrictMode 回归测试，覆盖 readiness 切换、pending finalize、persisted selection 与 resolver identity 变化的组合路径。
- 移除 React Scan 对非公开 instrumentation signal 的直接写入，保留现有诊断开关与 public `scan()` API。
- 不新增 dependency，不修改 Tauri API，不改变 client storage schema。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `codex-composer-startup-selection-stability`: 增加 startup readiness 与 pending-to-canonical 并发恢复必须有限收敛、不得 transiently clear selection 的要求。

## Impact

- Affected code:
  - `src/app-shell-parts/useSelectedComposerSession.ts`
  - `src/app-shell-parts/useSelectedComposerSession.test.tsx`
  - `src/services/reactScanController.ts`
  - `src/services/reactScanController.test.ts`
- APIs: 无 external API 变化。
- Dependencies: 不新增依赖。
- Storage: 保持现有 `composer/selectedModelByThread.*` key 与 value schema。

## 目标与边界

- 目标：selection reload 不得由自身 cache write 重新触发。
- 目标：pending thread 在 settings ready 后 seed selection，并在 finalize 后连续保留同一 selection。
- 目标：React Scan 仅通过 public API 控制 instrumentation。
- 边界：只修 AppShell composer startup convergence 与直接相关的诊断放大因素。

## 非目标

- 不重构 AppShell 全局 state ownership。
- 不迁移或清理用户本地 persisted state。
- 不改变模型 catalog、发送参数或 thread canonicalization 规则。
- 不关闭 production diagnostics 功能。

## 技术方案取舍

| 方案 | 做法 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| A. 增加 last-run ref 锁 | 相同 dependency key 只执行一次 | 改动小 | 容易跳过真实 selection 更新，掩盖状态契约问题 | 不采用 |
| B. 同步 cache ref + 有界 state 通知 | reload 从 ref 读取，cache state 只负责通知 resolver consumers；迁移与 reload 明确排序 | 切断自反馈，同时保留现有 public contract | 需要覆盖 ref/state 一致性测试 | 采用 |
| C. 重构为 reducer/external store | 将 hydration、migration、selection 合并为 state machine | 长期边界清晰 | hotfix 范围过大，回归面高 | 暂不采用 |

## 验收标准

- StrictMode 下 readiness 与 pending finalize 连续发生时，hook 在有限 render 内收敛且不报 React #185。
- canonical thread 不出现 selection 的 transient `null`，且 storage 只写入必要值。
- 等价 selection 不创建新 cache state reference，不重复持久化。
- React Scan controller 不再修改 `ReactScanInternals.instrumentation.isPaused.value`。
- Focused tests、lint、typecheck、build 与 strict OpenSpec validation 通过。
