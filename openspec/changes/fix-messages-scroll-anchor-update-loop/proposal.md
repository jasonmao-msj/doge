## Why

长对话在 streaming、virtualization 与自动滚底同时发生时，程序触发的 scroll event 会继续驱动 active message anchor state；anchor state render 又可能改变虚拟行布局并再次触发 `ResizeObserver`，最终形成 React update loop 并触发 error #185。现有 idempotent guard 只能拦截相同 anchor 的重复写入，无法阻止布局抖动时不同 anchor 之间的反馈回环。

## 目标与边界

- 切断 programmatic bottom-follow 与 active anchor React state 之间的反馈链。
- 保留用户手动滚动时的 anchor tracking、跳转、自动跟随和现有视觉表现。
- 变更限定在 `Messages` scroll/anchor coordination 及其 regression tests。

## What Changes

- 当消息视口已经位于 true bottom 时，active anchor 使用稳定的 latest message anchor，不再执行可能受 virtualization geometry 抖动影响的 viewport probe。
- 用户离开 bottom 后仍沿用现有 viewport anchor 计算，保持阅读导航行为不变。
- 增加 regression test，证明重复 programmatic bottom scroll 不会持续提交 anchor state，同时手动滚动仍能更新 anchor。

## 方案取舍

- 方案 A：提高 loop guard threshold 或扩大 cooldown。改动小，但只能推迟崩溃，不能消除不同 anchor 交替更新，拒绝。
- 方案 B：在 bottom 状态使用稳定 latest anchor，离开 bottom 后保留原 viewport probe。能够直接消除 geometry feedback，且不改变用户手动阅读导航，采用。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `conversation-render-surface-stability`: 补充 programmatic bottom-follow 与 active message anchor 状态隔离的稳定性契约。

## 非目标

- 不改变 message anchor rail、floating scroll control 或 timeline 的外观与布局。
- 不调整 virtualization threshold、streaming cadence 或 bottom-follow 开关语义。
- 不处理 `fastMarkdown.worker` 的 `document is not defined` 错误。
- 不修改 Sidebar Tooltip/Popover、Radix Presence 或 backend/runtime 代码。

## Impact

- Frontend: `src/features/messages/components/Messages.tsx`
- Tests: 现有 Messages live/anchor behavior test suite
- Specs: `conversation-render-surface-stability`
- API、dependency、storage schema 与 backend contract 均不变。

## 验收标准

- streaming/virtualized 长对话在重复 content resize 与 programmatic bottom-follow 下不再形成 anchor state update loop。
- 位于 bottom 时 active anchor 稳定指向 latest user message anchor。
- 用户向上滚动离开 bottom 后，active anchor 仍按 viewport 位置更新。
- 原有 UI markup、CSS class 与可见控制不发生变化。
