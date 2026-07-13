# 修复 Sidebar ScrollArea React 19 ref 回环

## Goal

修复 `@radix-ui/react-scroll-area@1.2.10` unstable composed-ref callback 在 React 19.2.7 production Sidebar render 中触发的 React `#185`。

关联 OpenSpec change：`fix-sidebar-scroll-area-react19-ref-loop`。

## Requirements

- 仅升级 `radix-ui` 聚合包下的 ScrollArea primitive 到 upstream fixed patch。
- 不升级整个 Radix 聚合包，不改 Sidebar/Messages/backend 行为。
- 增加 dependency resolution 与真实 StrictMode rerender regression。

## Acceptance Criteria

- [x] `npm ls` 显示 scoped `@radix-ui/react-scroll-area@1.2.14` 且 dependency tree valid。
- [x] ScrollArea focused test 在 React 19 StrictMode repeated rerender 下无 `#185`。
- [x] Sidebar/AppShell focused tests、typecheck、lint、build、OpenSpec validation 通过。
- [x] 新 production bundle 使用 stable `setScrollArea` composed ref signature。

## Technical Notes

保持 `radix-ui@1.4.3`，在现有 `overrides.radix-ui` 下增加 ScrollArea patch override。整体 Radix upgrade 留给独立 modernization change。
