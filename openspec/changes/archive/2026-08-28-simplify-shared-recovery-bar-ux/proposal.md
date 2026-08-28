## Why

Shared 会话 `recovery-required` 已具备 Probe / Stop / Rebuild / Abandon 后端能力，但默认把四个工程动作平铺给用户，文案难懂；放弃本轮使用 `window.confirm`，在 macOS WKWebView 会静默失败、在 Windows WebView2 上易卡死，社区反馈只能重启。需要把出口做成「单行两主按钮 + 自动处理梯子」，并用应用内弹窗替代原生 confirm。

## What Changes

- 折叠态恢复条固定单行：标题 · 一行摘要 + 详情 icon +「自动处理」+「跳过本轮，继续聊」+ 展开箭头
- 详情 icon 打开应用内说明弹窗（非原生 alert）
- 「自动处理」串行执行既有 exit ladder（查 owner → recover → 必要时 interrupt → 必要时 rebuild），不自动 abandon
- 「跳过本轮」= durable abandon；二次确认改用 `ConfirmDialog`，**禁止** `window.confirm` / 原生 dialog
- 展开区保留高级动作：再查一次 / 停止请求（无可停则禁用）/ 换连接
- 工具条仍挂在 Composer 底部集群（位置不变）

## 目标与边界

- **目标**：默认 UX 可完成解锁（≤ 少数明确点击）；消除原生 confirm 导致的假失败/卡死；按钮真实调用现有 RPC
- **边界**：不改变 Shared 线性锁合同、不新增 send 状态枚举、不自动 blind retry、不改后端 abandon/rebuild 语义

## 非目标

- 不实现「recovery 中换 Target 继续聊」（需 Queue/Branch）
- 不在本 change 做「渠道炸了」与 recovery 的完整失败分类大修（可 follow-up）
- 不提供全局多会话一键解锁管理中心

## Capabilities

### New Capabilities

- `shared-recovery-bar-ux`：Shared recovery 状态条产品交互（单行、自动处理、跳过、详情弹窗、展开高级）

### Modified Capabilities

- `shared-session-recovery-exit`：UI 默认呈现从四按钮平铺改为两主按钮 + 自动梯子；确认必须为应用内对话框

## Impact

- FE：`SharedSendStatusBar.tsx`、`shared-send-status.css`、`sharedSend` i18n、相关 vitest
- 复用：`ConfirmDialog` / `AlertDialog`、既有 `sharedSessionV2*` RPC
- 无 Rust 合同变更（除非实现中发现 abandon 路径缺陷，则最小修补）

## 验收标准

1. 折叠条视觉上单行；长文案省略
2. 无 `window.confirm` 出现在 recovery 路径
3. 自动处理成功可 idle；失败仍 recovery 且可跳过
4. 跳过确认用自定义弹窗，确认后 abandon 解锁
5. 展开高级按钮调用与旧四按钮等价能力
6. 既有 recovery exit 单测更新并通过
