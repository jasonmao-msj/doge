## Context

Production error report 可 1:1 对应当前 `dist/assets/App-C2u7zJPh.js`。`componentStack` 中 `qjt` 映射到 `ComposerImpl`，错误 stack 的 `App-C2u7zJPh.js:543:16313` 位于 active thread reset effect 内的 `setRewindMode` dispatch。React vendor stack 同时表明异常发生在 passive effect 执行 state setter 时。

当前两个 effect 分别订阅 `activeThreadId` 与 `[onRewind, rewindSupportedEngine]`，并通过 functional updater 返回旧值来表达 no-op。该写法把“是否需要更新”的判断交给 dispatch 之后的 React eager bailout；在 pending lanes 下并不保证跳过 update scheduling。

约束：保持 rewind 产品语义；不引入 dependency；不扩大到 Composer 全状态重构；兼容 React 19 StrictMode。

## Goals / Non-Goals

**Goals:**

- 在 setter dispatch 之前完成 semantic equality 判断。
- thread transition 与 capability transition 共用一个稳定 reset contract。
- effect dependency 使用 primitive semantic state，不订阅非必要 function identity。
- 留下可执行 regression test 与 production bundle 映射记录。

**Non-Goals:**

- 不改变 rewind preview 构造、workspace restore 或 fork 行为。
- 不改变 `useEventCallback` 的实现或 public contract。
- 不处理没有 stack evidence 指向的 Composer 其他 reset effects。

## Decisions

### 1. 复用 `useEventCallback` 承载 stable reset callback

`useEventCallback` 已在仓库内提供 stable identity 与 latest committed closure。reset callback 在 passive effect 或 user event 后调用，符合该 helper 的使用边界。它读取最新 `rewindPreviewState` / `rewindMode`，仅在目标值不同时调用 setter。

替代方案：把 state 加入 reset effect dependency。拒绝，因为用户在弹层内选择 `files-only` 会重新触发 reset，破坏交互。

### 2. effect 依赖 `canRewindSession` primitive boolean

capability reset 只关心 `onRewind` 是否存在以及 engine 是否支持，不关心 callback identity。先计算 `Boolean(onRewind && rewindSupportedEngine)`，effect 订阅该 boolean。

替代方案：保留 `[onRewind, rewindSupportedEngine]`。拒绝，因为 parent callback churn 会扩大 passive effect 执行频率，且与业务语义不一致。

### 3. 两条 transition 共用 reset function，不引入 reducer

thread 变化始终 reset；capability 不可用时 reset。两条 effect 保留独立触发条件，但调用同一 shared root function。

替代方案：合并 reducer 或 key-remount Composer。拒绝，因为会扩大 diff 或清除无关 draft state。

## Risks / Trade-offs

- [Risk] `useEventCallback` 只在 commit 后更新 latest closure → reset 仅从 effect/event 调用，不在 render phase 调用，并以 regression test 覆盖。
- [Risk] regression harness 难以稳定复现 production pending-lane 调度 → 同时验证 observable reset behavior、callback identity contract，并以 source-to-bundle evidence 记录根因。
- [Risk] 相邻 reset effect 仍可能成为其他 update loop 来源 → 本次仅修复 exact stack；playbook 保留后续 case 分类，不做无证据重构。

## Migration Plan

1. 修改 Composer reset contract 与 focused test。
2. 运行 focused Vitest、typecheck、lint 与 strict OpenSpec validation。
3. 同步 main spec 与 React #185 playbook。
4. 回滚时可单独 revert 本次 commit；无数据 migration、feature flag 或 backend rollback。

## Open Questions

- 无。production bundle、source location 与 React dispatch stack 已闭环。
