## Context

`useSelectedComposerSession` 同时维护 render state、同步 ref、内存 cache 与 client storage。当前 `reloadSelectedComposerSelection` 读取 `selectedComposerSelectionBySessionKey`，又在同一次 `useLayoutEffect` 中写回该 state；因此 callback identity 会被自己的写入改变。单一路径通常两次 render 后收敛，但 settings readiness、pending identity finalize 与 migration effect 并发时，会形成多阶段同步更新，并短暂清空 canonical thread selection。

React Scan 在 bootstrap 前通过 public `scan()` 安装是现有 production diagnostics contract，但 controller 还直接修改非公开 `ReactScanInternals.instrumentation.isPaused.value`。这会把诊断工具内部 signal 写入带入启动关键路径，且没有 public compatibility guarantee。

## Goals / Non-Goals

**Goals:**

- reload effect 的 dependency graph 不包含它自己写入的 cache state。
- memory cache ref 与 React cache state 保持一致，resolver consumers 仍能收到真实变化通知。
- pending selection finalize 到 canonical key 时，不出现 transient clear。
- diagnostics 保留现有开关，但只调用 React Scan public API。
- 用 StrictMode 和 write-count assertions 锁住有限收敛边界。

**Non-Goals:**

- 不重构 composer domain 为 reducer 或 external store。
- 不改变 selection storage key/value schema。
- 不关闭 production React Scan capability。
- 不调整模型 catalog 或 canonical thread resolver 的业务规则。

## Decisions

### Decision 1: 使用同步 cache ref 切断 reload 自反馈

新增 `selectedComposerSelectionBySessionKeyRef` 作为 orchestration 层同步 snapshot。所有 cache writes 先比较逻辑值，再同步 ref，并仅在真实变化时更新 React state。`reloadSelectedComposerSelection` 从 ref 读取，因此其 callback 不再依赖自己写入的 state。

Alternatives:

- last-run key ref：会把合法的同 key selection 更新误判为已处理。
- 删除 React cache state：会改变 `resolveComposerSelectionForThread` 的更新通知语义。

### Decision 2: migration 在 reload 前以 layout phase 完成

pending-to-canonical migration 需要在当前浏览器 paint 前完成，且必须先于 selection reload。将 migration effect 与 reload effect置于同一 layout phase，并保持 migration 声明在前；migration 同步写 storage/ref 后，reload 即使捕获旧 render state，也可读取最新 ref/storage candidate。

Alternatives:

- 全部改成 passive effect：可降低同步 update 风险，但会让 active thread 在一帧内携带前一线程 selection。
- render 阶段直接迁移：违反 render purity，并把 storage side effect 带入 render。

### Decision 3: 等价更新统一走一个 cache writer

复用单一 `writeSelectionForSessionKey` 来执行 ref/state/storage equality gate，避免 seed、inherit、draft 与 migration 分支各自维护不同写入规则。只有需要“读取 store 后注入 memory cache”且无需重复落盘时，使用内部 memory-cache helper。

### Decision 4: React Scan 不再修改 internals

保留 persisted options sanitize 和 `scan({ enabled: true })`，删除对 `ReactScanInternals.instrumentation.isPaused` 的赋值。归因状态仍可只读查询 internals，写控制必须经过 public API。

## Risks / Trade-offs

- [Risk] ref/state 更新时序不一致导致 resolver 读到旧 selection。→ 所有 cache mutation 收敛到 helper，并测试 rerender 后 resolver 返回 canonical selection。
- [Risk] migration layout effect 增加一次同步 state update。→ equality gate 确保每个 migration key 最多产生一次真实 cache write，reload 不再由该 state write 重触发。
- [Risk] React Scan persisted pause 不能靠 internals 强制解除。→ sanitize persisted options 后调用 public `scan({enabled:true})`，测试验证传参和 options 修复。

## Migration Plan

1. 新增组合回归测试并记录旧实现的多阶段 render/write 行为。
2. 引入 cache ref/helper，切断 reload 对 cache state 的依赖。
3. 调整 migration/reload effect 顺序并验证 pending-to-canonical continuity。
4. 删除 React Scan internals write，更新 controller tests。
5. 执行 focused tests、lint、typecheck、build 与 OpenSpec strict validation。

Rollback：回退本 change 的 frontend 与 spec 文件即可；无 storage migration 和 backend API 变更。

## Open Questions

- 无。若修复后真实包仍出现 #185，应以新 diagnostics stack 建立独立 change，不继续扩张本 hotfix。
