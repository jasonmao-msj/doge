## 背景

macOS Tauri 侧栏 titlebar 已提供：

- `GlobalSearchTitlebarButton`（搜索）
- `QuickSwitcherTitlebarButton`（`cmd+e`）
- `SidebarCollapseButton`（隐藏/显示对话侧栏）

Windows 自绘侧栏无等价 titlebar 槽，搜索已下沉到主导航列表（`showWinChromeEntries = !isMacDesktopHost()`），但 Quick Switcher 与收起侧栏未跟进。

## 方案

**选定：Win 列表式入口 + 复用既有 handlers**

| Option | Summary | Trade-off |
|--------|---------|-----------|
| A. 主导航 + 设置菜单补入口（采用） | 与现有搜索行同风格；设置菜单顶放隐藏侧栏 | 平台分支与搜索同门控 |
| B. 在 Win 伪造 mac 图标 titlebar | 视觉更齐 | 大改布局，超出「只调 UI」 |
| C. 仅快捷键、无可见按钮 | 实现更小 | 可发现性差，用户明确要按钮 |

### 门控

- 平台：`!isMacDesktopHost()`（与搜索主导航一致；non-Tauri preview 也展示以便 web 预览）。
- 能力：handler 存在才渲染（`onOpenQuickSwitcher` / `onCollapseSidebar`）。

### 快捷键展示

- Quick Switcher 运行时绑定硬编码为 `cmd+e`（`useAppShellQuickSwitcherSection`）。
- 主导航徽章用 `formatShortcutForPlatform("cmd+e")` → Win 显示 `Ctrl+E`。

### 隐藏侧栏菜单项

- 文案：`sidebar.hideThreadsSidebar`（与 mac tooltip 同源）。
- 图标：`PanelLeftClose`（与 `SidebarCollapseButton` 展开态一致）。
- **不**加入 `PINNABLE_SETTINGS_ACTION_IDS`（避免占用 2 个 pin 名额、且收起后 pin 图标语义尴尬）。

## 接线

```
useAppShellQuickSwitcherSection.handleOpenQuickSwitcher
useLayoutController / shell collapseSidebar
  → useAppShellLayoutNodesSection (workspace options)
  → useLayoutNodes → Sidebar
       ├─ primary nav Quick Switcher button
       └─ SidebarSettingsMenu showHideThreadsSidebar + onCollapseSidebar
```

## 风险

- 误在 mac 双入口：靠 `isMacDesktopHost()` 与 titlebar 互斥。
- 快捷键文案漂移：常量与 section 硬编码同为 `cmd+e`；若日后可配置需同步。
