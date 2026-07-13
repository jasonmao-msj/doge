## Context

`Messages` 同时拥有 bottom-follow、message anchor tracking 与 virtualized timeline。当前 `scheduleAnchorUpdate` 在每个 scroll event 后通过 DOM geometry 选择 active anchor；而 bottom-follow 的 `ResizeObserver` 会命令式写入 `scrollTop`。长对话的 virtual row measurement 可能在同一收敛窗口内持续改变 geometry，使 programmatic scroll、anchor state render 与下一轮 resize 互相反馈。

现场 diagnostics 已记录连续 `messages/overlay-loop-guard` 与 `ResizeObserver loop completed with undelivered notifications`，production component stack 落在 `ActiveCanvasMessages -> Messages`。约束是保持 DOM、CSS、controls 与 user-driven navigation 行为不变。

## Goals / Non-Goals

**Goals:**

- bottom-follow 到达 true bottom 时，以稳定的 latest user message id 作为 active anchor。
- 用户离开 bottom 后继续使用现有 viewport geometry probe。
- 不让 programmatic bottom scroll 因 virtualized geometry 抖动持续提交 anchor React state。
- 用 focused regression test 覆盖 bottom 与 away-from-bottom 两条路径。

**Non-Goals:**

- 不修改视觉、markup、CSS、virtualization 参数或 streaming cadence。
- 不重构整个 scroll ownership，也不引入 dependency。
- 不处理 Markdown worker、Sidebar 或 Radix 相关问题。

## Decisions

### Decision 1: bottom 状态采用语义 anchor，不采用 geometry anchor

`scheduleAnchorUpdate` 执行时先检查 message container 是否 near bottom。若是，直接选择 `messageAnchors` 的最后一项；若否，保持 `resolveActiveMessageAnchor` 的现有 viewport probe 与 fallback。

原因：bottom 的用户语义就是“正在看最新消息”，latest anchor 不依赖 virtual row 的瞬时高度，能够使 state 在一次提交后稳定。

替代方案：用 ref 标记 programmatic scroll 并忽略下一次 scroll event。WebKit 的 scroll event 与 `ResizeObserver` notification 时序不是单次一一对应，flag 容易过早清除或吞掉真实用户滚动，因此不采用。

### Decision 2: 不扩大 loop guard

保留现有 idempotent guard 作为 diagnostics 与相同值写入保护，但不改变 threshold。提高 threshold 只会延迟 React #185，无法解决不同 anchor 交替变化。

### Decision 3: 测试行为，不测试实现细节

回归测试触发 scroll 并改变 container geometry，断言 bottom 时 active anchor 稳定为 latest、离开 bottom 后仍跟随 viewport。测试不依赖新增 UI 或 CSS snapshot。

## Risks / Trade-offs

- [Risk] near-bottom threshold 内 active anchor 会提前指向 latest anchor → 这是既有 bottom-follow 的语义区域；测试锁定离开 threshold 后仍按 viewport 更新。
- [Risk] 测试环境缺少真实 virtualization layout → 通过可控 `scrollHeight/clientHeight/scrollTop` 与重复 scroll callback 验证 state 收敛，production diagnostics 继续承担现场观察。

## Migration Plan

1. 增加 focused test 并确认旧逻辑可复现不稳定选择。
2. 在 `scheduleAnchorUpdate` 内加入 bottom semantic selection。
3. 运行 Messages focused tests、typecheck 与 OpenSpec strict validation。

Rollback 仅需回退 `Messages.tsx` 的条件选择与对应 tests/spec artifacts；没有 data migration、dependency 或 backend 影响。

## Open Questions

无。若后续仍出现非 bottom 场景的 anchor oscillation，应作为独立问题基于新增 diagnostics 处理，不在本次扩大范围。
