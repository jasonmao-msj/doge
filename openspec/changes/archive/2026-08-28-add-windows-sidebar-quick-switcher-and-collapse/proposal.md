## Why

Windows / non-macOS 侧栏缺少与 mac titlebar 对等的两个 chrome 入口：

1. **Quick Switcher（Ctrl+E）**：mac 在 titlebar 有 `QuickSwitcherTitlebarButton`，Win 主导航只有搜索（Ctrl+O），用户无法从列表一键打开切换器。
2. **隐藏对话侧边栏**：mac 在 titlebar 有 `SidebarCollapseButton`（「隐藏对话侧边栏」），Win 设置菜单只有锁屏 / Spec Hub / 项目记忆 / Git Graph / 设置，无法从菜单收起侧栏。

需要 **仅补 UI 入口**，复用既有 `handleOpenQuickSwitcher` 与 `collapseSidebar`，不改快捷键语义、不改 mac chrome。

## 目标与边界

### 目标

- non-macOS（`!isMacDesktopHost()`）主导航「搜索」下方增加 Quick Switcher 行，展示 `Ctrl+E`（与硬编码 `cmd+e` 一致），点击打开 Quick Switcher。
- non-macOS 设置下拉菜单顶部增加「隐藏对话侧边栏」（无 pin 勾选），点击调用 `collapseSidebar`。
- macOS Tauri host：不渲染上述两项（继续只用 titlebar）。

### 边界

- 不改 Quick Switcher 快捷键绑定、不改 collapse/expand 状态机。
- 不把「隐藏对话侧边栏」纳入 settings pin 列表（与「设置」同级一次性动作）。
- 不把 mac titlebar 图标行复制成 Win 顶栏；保持 Win 列表式主导航风格。

## 非目标

- 不改 i18n key 语义（复用 `quickSwitcher.open`、`sidebar.hideThreadsSidebar`）。
- 不改 phone / compact 布局策略。
- 不实现「展开侧栏」的设置菜单镜像项（收起后既有 expand chrome 不变）。

## What Changes

| 区域 | 变更 |
|------|------|
| `Sidebar.tsx` | non-mac 主导航 Quick Switcher；向设置菜单传 collapse |
| `SidebarSettingsMenu.tsx` | 可选「隐藏对话侧边栏」菜单项（无 pin） |
| `layoutNodesTypes` / `useLayoutNodes` | 透传 `onOpenQuickSwitcher` / `onCollapseSidebar` |
| `useAppShellLayoutNodesSection` | 接线 `handleOpenQuickSwitcher` + `collapseSidebar` |
| Tests | Win 快捷键徽章、点击回调、无 handler 时不展示隐藏项 |

## Capabilities

### New Capabilities

- `windows-sidebar-chrome-parity`：non-macOS 侧栏主导航 / 设置菜单与 mac titlebar 在 Quick Switcher 与隐藏对话侧栏上的入口 parity。

### Modified Capabilities

- 无

## 验收标准

1. Win：主导航搜索下可见 Quick Switcher + `Ctrl+E`；点击打开切换器。
2. Win：设置菜单顶部可见「隐藏对话侧边栏」；点击后侧栏收起。
3. Mac Tauri：主导航无 Quick Switcher 行，设置菜单无隐藏侧栏项。
4. 未传入 handler 时对应入口不渲染。
5. focused vitest：`Sidebar.test.tsx` 相关用例绿。

## Impact

| 层 | 影响 |
|----|------|
| App Sidebar UI | 主导航 + 设置菜单 |
| Layout wiring | optional props 透传 |
| App shell | 复用既有 open/collapse handlers |
| OpenSpec | 本 change + capability delta |
