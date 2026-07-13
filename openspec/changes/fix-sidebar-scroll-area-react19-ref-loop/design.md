## Context

截图中的 production asset hash `App-Db8tvBdh.js` 与当前 `dist` 完全一致，排除了旧安装包。按 stack 行列还原得到：

```text
Primitive.div
  -> ScrollAreaProvider
  -> ScrollArea.Root
  -> ScrollArea wrapper
  -> Sidebar
  -> AppLayout
  -> AppShell
```

当前 `@radix-ui/react-scroll-area@1.2.10` 的 Root 使用 `useComposedRefs(forwardedRef, node => setScrollArea(node))`。第二个 ref dependency 每次 render 都是新函数；React 19 在 ref identity 改变时执行 detach/attach，callback 又同步更新 Root state，使部分 production commit 时序进入 nested update loop。Radix 2026-06-30 release 将这一类问题定义为 React 19 unstable composed-ref callback infinite rerender，并在新 patch 中改用稳定 state setter。

## Goals / Non-Goals

**Goals:**

- 让 Sidebar ScrollArea 的 Root composed ref 在 render 间保持稳定。
- 将 dependency 影响限定在 `radix-ui` 聚合包下的 ScrollArea primitive。
- 同时验证 source-level fix、dependency resolution 与 React mount behavior。

**Non-Goals:**

- 不重写 ScrollArea wrapper 或 Sidebar layout。
- 不做全量 Radix dependency modernization。
- 不把所有 `#185` 归因于同一根因。

## Decisions

### Decision 1: scoped transitive override

在现有 `overrides.radix-ui` 下增加 `@radix-ui/react-scroll-area: 1.2.14`，与已经 scoped 的 Presence override 保持同一 ownership。这样只有通过 `radix-ui` 聚合包使用的 ScrollArea 被升级；Excalidraw 等独立 dependency tree 不受影响。

### Decision 2: 不修改业务组件规避 library bug

不把 Sidebar 改回 native overflow，也不通过 conditional mount、memo 或延时 render 掩盖 ref churn。业务层 workaround 会改变 scrollbar/a11y/布局 contract，且无法保证 Settings/Release Notes 的共享 ScrollArea 不复现。

### Decision 3: 三层验证

1. `package-lock`/`npm ls` 锁定实际 resolved version。
2. focused Vitest 真实挂载 `ScrollArea`，在 `StrictMode` 下连续 parent rerender 并检查 DOM/ref continuity 与 console error。
3. production build 后检查 minified bundle 中 Root composed ref 使用 stable setter signature。

## Risks / Trade-offs

- [Risk] patch 版本带入 ScrollArea 内部其它修复 → Mitigation：同 minor line `1.2.x`，运行全部 ScrollArea consumers 的 focused tests 与 AppShell startup suite。
- [Risk] override 被未来 `radix-ui` 升级遗忘 → Mitigation：dependency contract test 和 OpenSpec 明确退出条件；整体升级到已包含 fixed ScrollArea 的版本后可删除 override。
- [Risk] jsdom 无法完全复现 WebKit commit timing → Mitigation：测试作为 deterministic guard，production bundle source signature 作为实现证据，最终仍保留真实安装包验收。

## Migration Plan

1. 添加 scoped override 并刷新 lockfile。
2. 添加 focused dependency/mount regression。
3. 运行 focused tests、AppShell startup tests、typecheck、lint、build 与 strict validation。
4. 检查新 bundle stable ref signature，交付新 hash 做客户端复验。

Rollback：删除新增 ScrollArea override、恢复 lockfile、删除 focused contract test；无数据迁移或 backend 回滚。
