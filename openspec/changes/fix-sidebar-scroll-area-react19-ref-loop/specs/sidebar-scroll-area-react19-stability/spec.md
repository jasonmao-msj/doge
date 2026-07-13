## ADDED Requirements

### Requirement: Sidebar ScrollArea MUST keep composed refs stable under React 19

系统 SHALL 使用已修复 unstable composed-ref callback 的 ScrollArea primitive，并 MUST 在 React 19 render/ref lifecycle 下收敛而不进入同步 state update loop。

#### Scenario: Sidebar parent repeatedly rerenders

- **WHEN** Sidebar 中的真实 ScrollArea 在 React `StrictMode` 下因 workspace/thread projection 连续 rerender
- **THEN** ScrollArea Root 与 Viewport MUST 保持可用且复用同一已挂载 DOM node
- **AND** application MUST NOT report React `Maximum update depth exceeded` 或 minified error `#185`

#### Scenario: Production dependency graph is installed

- **WHEN** release build 从 `package-lock.json` 安装 frontend dependencies
- **THEN** `radix-ui` 使用的 `@radix-ui/react-scroll-area` MUST resolve 到包含 stable composed-ref fix 的版本
- **AND** dependency tree MUST NOT 通过 invalid 或 broad global override 改写无关 Radix consumers

#### Scenario: Scroll behavior remains unchanged

- **WHEN** 用户在 Sidebar viewport 中滚动 workspace 与 thread rows
- **THEN** native scrolling、custom scrollbar、scroll fade 与 viewport ref behavior MUST 保持现有语义
- **AND** 修复 MUST NOT 修改 Sidebar thread projection、Messages state 或 backend/runtime contract
