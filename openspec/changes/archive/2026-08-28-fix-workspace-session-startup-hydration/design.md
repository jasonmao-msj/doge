# Design: workspace session startup hydration

## Decision

在 `useWorkspaceThreadListHydration` 中增加 gate-ready 后的单步 idle queue。queue 每次从 workspace registry 选择一个满足条件的目标，并调用既有 `ensureWorkspaceThreadListLoaded`。该函数在未 hydration 时自然选择 `first-paint`，由既有 `StartupOrchestrator` 负责 dedupe、phase concurrency 和 `thread-session-scan` heavy cap。

## Scheduling

1. active workspace first-paint settle，发布新的 hydrated Set，并完成 startup gate。
2. effect 重新运行，跳过 active projection owners、collapsed/disconnected、loading/in-flight/已 hydration workspace。
3. 使用 `scheduleIdleHydration` 只安排一个目标；callback 执行后清理 pending marker。
4. 目标 settle 后 hydrated Set 或 loading state 变化，effect 再选择下一个目标。

## Safety

- cold-start guard 仍由 `listThreadsForWorkspaceTracked` 和 `ensureWorkspaceThreadListLoaded` 双重执行；gate 未 ready 时不会真正扫描非 active workspace。
- queue 使用 UI hydration Set，而不是 full-catalog Set，避免 first-paint 完成后重复选择同一 workspace。
- background 目标只使用 `first-paint`，不进入 OpenCode、Claude seed 或完整 catalog 扫描。
- effect cleanup 复用已有 `idleHydrationCleanupByWorkspaceIdRef`，组件卸载时取消尚未执行的 callback。

## Validation Matrix

| Case | Expected |
| --- | --- |
| active first-paint 未完成 | 非 active 不调用 `listThreadsForWorkspace` |
| active first-paint 完成，普通 sibling | sibling 以 `idle-prewarm` + `first-paint` 调用 |
| sibling collapsed/disconnected | 不自动调用 |
| two siblings | 先完成一个，再推进下一个；不重复调用 |
| no active workspace | 不改变现有 Home 行为 |
