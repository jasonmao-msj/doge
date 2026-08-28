## 1. UI 与接线

- [x] 1.1 `Sidebar` non-mac 主导航增加 Quick Switcher（`GalleryVerticalEnd` + `Ctrl+E` 徽章）
  - 验证：Win 平台测可见 `Ctrl+E` 且 click 调 `onOpenQuickSwitcher`
- [x] 1.2 `SidebarSettingsMenu` 增加「隐藏对话侧边栏」（无 pin）
  - 验证：有 `onCollapseSidebar` 时 click 收起；无 handler 不渲染
- [x] 1.3 `layoutNodesTypes` / `useLayoutNodes` / `useAppShellLayoutNodesSection` 透传 handlers
  - 验证：类型与运行时接线存在

## 2. 测试

- [x] 2.1 扩展 `Sidebar.test.tsx`：Win quick nav 含 Ctrl+E；隐藏侧栏菜单项
  - 验证：focused vitest 绿
- [x] 2.2 test-utils i18n mock 补 `quickSwitcher.open` / `sidebar.hideThreadsSidebar`

## 3. OpenSpec

- [x] 3.1 本 change：proposal / design / tasks / capability delta
- [x] 3.2 登记 `openspec/changes/README.md` active 索引

## 进度事实

- 实现 commit：与本 OpenSpec 同提交（author chenxiangning）
- 用户手测：Win 入口已确认可见可用
