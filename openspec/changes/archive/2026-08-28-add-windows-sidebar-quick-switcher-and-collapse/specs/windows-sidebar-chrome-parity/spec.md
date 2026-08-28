## ADDED Requirements

### Requirement: non-macOS primary nav MUST expose Quick Switcher when handler is provided

当 host 不是 macOS Tauri desktop（`!isMacDesktopHost()`）且上层传入 `onOpenQuickSwitcher` 时，侧栏主导航 MUST 在全局搜索项之后渲染 Quick Switcher 入口；快捷键展示 MUST 与运行时硬编码 `cmd+e` 的平台格式化结果一致（Windows 为 `Ctrl+E`）。

#### Scenario: Windows shows Quick Switcher under Search

- **WHEN** 运行于 Windows（或 non-mac desktop host）且 `onOpenQuickSwitcher` 已接线
- **THEN** 主导航 MUST 显示 Quick Switcher 文本入口
- **AND** 快捷键徽章 MUST 包含 `Ctrl+E`（或等价平台格式化结果）
- **AND** 用户激活该入口 MUST 调用 `onOpenQuickSwitcher`

#### Scenario: missing handler hides Quick Switcher row

- **WHEN** 未传入 `onOpenQuickSwitcher`
- **THEN** 主导航 MUST NOT 渲染 Quick Switcher 行

#### Scenario: macOS Tauri host omits primary-nav Quick Switcher

- **WHEN** host 为 macOS Tauri desktop
- **THEN** 主导航 MUST NOT 渲染 Quick Switcher 行（titlebar 入口为唯一 chrome）

### Requirement: non-macOS settings menu MUST expose hide conversation sidebar when handler is provided

当 host 不是 macOS Tauri desktop 且上层传入 `onCollapseSidebar` 时，侧栏设置下拉菜单 MUST 提供「隐藏对话侧边栏」菜单项；该项 MUST NOT 提供 settings pin 勾选。

#### Scenario: Windows settings menu collapses sidebar

- **WHEN** 运行于 non-mac host 且 `onCollapseSidebar` 已接线
- **AND** 用户打开设置下拉并选择「隐藏对话侧边栏」
- **THEN** 系统 MUST 调用 `onCollapseSidebar`
- **AND** 菜单 MUST 关闭

#### Scenario: hide item is not pinnable

- **WHEN** 设置下拉展示「隐藏对话侧边栏」
- **THEN** 该项 MUST NOT 显示 pin 复选框
- **AND** MUST NOT 写入 `sidebarSettingsPinnedActions`

#### Scenario: macOS Tauri host omits hide item in settings menu

- **WHEN** host 为 macOS Tauri desktop
- **THEN** 设置下拉 MUST NOT 包含「隐藏对话侧边栏」菜单项（titlebar collapse 为唯一 chrome）

#### Scenario: missing collapse handler hides menu item

- **WHEN** 未传入 `onCollapseSidebar`
- **THEN** 设置下拉 MUST NOT 渲染「隐藏对话侧边栏」
