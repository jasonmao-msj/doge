## Why

当前 `0.7.2` production bundle 在 Sidebar 首屏渲染期间仍可能触发 React `#185`。bundle 行列反查已将 component stack 精确定位到 `Radix ScrollArea Root -> ScrollAreaProvider -> Sidebar`；当前解析的 `@radix-ui/react-scroll-area@1.2.10` 使用不稳定的 inline composed-ref callback，在 React 19 ref detach/attach 语义下会通过 `setScrollArea` 形成同步更新回环。

## 目标与边界

- Sidebar ScrollArea 在 React 19 下反复 render 时保持 root/viewport ref identity 收敛，不触发 maximum update depth。
- 采用包含 upstream stable composed-ref fix 的最小 dependency patch，不扩大 Radix 升级面。
- 用 production dependency contract 与真实 primitive mount test 锁定修复。

## What Changes

- 仅将 `radix-ui` 聚合包内的 `@radix-ui/react-scroll-area` override 到 upstream fixed patch `1.2.14`。
- 增加 dependency resolution contract，防止 lockfile 回退到含 unstable ScrollArea ref callback 的版本。
- 增加 React 19 `StrictMode` 下真实 ScrollArea repeated-rerender regression test。
- 保留 Sidebar markup、scroll fade、scrollbar、thread projection 与用户交互语义。

## 方案比较与取舍

- 方案 A：整体升级 `radix-ui@1.4.3 -> 1.6.2`。能获得全量 upstream fixes，但会同时升级几十个 primitives，回归面与当前单点故障不匹配，拒绝。
- 方案 B：全局 override `@radix-ui/react-compose-refs@1.1.3`。改动看似更小，但会改变所有 Radix consumers，且 ScrollArea `1.2.10` 自身仍创建 unstable inline callback，不能从 source contract 上消除根因，拒绝。
- 方案 C：仅 override `radix-ui > @radix-ui/react-scroll-area@1.2.14`。该版本已将 Root composed ref dependency 改为稳定的 `setScrollArea`，影响面限定在聚合包的 ScrollArea，采用。

## 非目标

- 不升级整个 `radix-ui` 聚合包。
- 不修改 `Sidebar.tsx`、ScrollArea DOM/CSS、scroll fade 或 thread list state。
- 不处理 Messages anchor、Tooltip/Popover、backend/runtime 或其它独立 React `#185` 来源。
- 不声称所有第三方 Radix dependency 已统一升级。

## Capabilities

### New Capabilities

- `sidebar-scroll-area-react19-stability`: 约束 Sidebar 使用的 ScrollArea dependency/ref chain 在 React 19 下稳定收敛，并要求 production resolution 可验证。

### Modified Capabilities

无。

## Impact

- Dependency manifest/lockfile: `package.json`、`package-lock.json`。
- Focused regression: `src/components/ui/scroll-area.test.tsx`。
- OpenSpec: `openspec/changes/fix-sidebar-scroll-area-react19-ref-loop/**`。
- 无 API、storage schema、backend、CSS 或 user-visible behavior 变更。

## 验收标准

- `npm ls` 证明 `radix-ui` 使用 `@radix-ui/react-scroll-area@1.2.14`，且没有 invalid dependency tree。
- 真实 ScrollArea 在 React 19 `StrictMode` 下重复 parent rerender，不报告 `Maximum update depth exceeded` / minified `#185`。
- Sidebar focused tests、AppShell startup tests、typecheck、lint 与 production build 通过。
- production bundle 的 ScrollArea Root 使用稳定 `setScrollArea` composed ref，而不是每 render 新建 inline setter callback。
