## Why

CC GUI 0.7.16 的 production bundle `App-C2u7zJPh.js` 在 `Composer` rewind reset passive effect 中触发 React #185。当前逻辑虽然让 functional updater 返回旧值，但仍先进入 React state dispatch；在 React 19 pending lanes 与父级更新交错时，重复 dispatch 不能作为稳定收敛契约，导致整个桌面窗口被 global error boundary 接管。

## 目标与边界

- 修复 thread 切换及 rewind capability 变化时的 rewind UI reset，使语义未变化时不触发 state dispatch。
- effect 仅依赖稳定的 thread identity、primitive capability 状态与 stable callback。
- 保留现有 `messages-and-files` 默认策略、确认弹层及 rewind 执行语义。
- 增加可执行 regression coverage，并把本次 production stack 映射沉淀到 React #185 playbook。

## 非目标

- 不重构 Composer 全部 local state 或引入 reducer/state library。
- 不修改 Claude/Codex rewind backend、workspace restore、fork 或 export protocol。
- 不借本次修复处理未被证据指向的其他 render 性能问题。

## What Changes

- 复用既有 `useEventCallback`，建立 stable rewind reset callback，并在 dispatch 前比较 committed state。
- 将 rewind availability 收敛为 primitive boolean，避免 effect 订阅 `onRewind` function identity。
- 添加 thread/capability transition regression test，覆盖 reset 语义和 React #185 防回归。
- 更新 renderer stability contract 与故障案例文档。

## 方案取舍

- **方案 A（采用）**：stable event callback + pre-dispatch semantic guard。最小变更、复用现有 helper，直接消除无意义 dispatch。
- **方案 B（不采用）**：将 rewind state 合并到 reducer。可增强原子性，但扩大变更面且不符合本次 hotfix 的 YAGNI 边界。
- **方案 C（不采用）**：按 thread key remount Composer。能清空 local state，但会同时丢失 draft、selection 等无关状态，回归风险过高。

## Capabilities

### New Capabilities

<!-- 无新增 capability。 -->

### Modified Capabilities

- `client-renderer-stability-under-pressure`: 增加 Composer rewind reset 在 thread/capability transition 下必须收敛、不得触发 React #185 的行为要求。

## Impact

- Frontend: `src/features/composer/components/Composer.tsx`
- Tests: `src/features/composer/components/Composer.rewind-confirm.test.tsx`
- Behavior contract: `openspec/specs/client-renderer-stability-under-pressure/spec.md`
- Knowledge base: `docs/analysis/react-185-maximum-update-depth-playbook.md`
- Dependencies/API: 无新增依赖，无 public API 或 persisted data schema 变更。

## 验收标准

- thread identity 变化时，已打开 rewind preview 被关闭且 mode 恢复 `messages-and-files`。
- rewind capability 可用性变化时，reset 只按 primitive semantic state 触发；callback identity churn 不参与 effect contract。
- reset 目标值已满足时，不调用 React state setter。
- focused Vitest、`npm run typecheck`、`npm run lint`、OpenSpec strict validation 通过。
- code review 不存在未解决的 correctness、regression 或 spec drift finding。
