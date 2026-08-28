## Why

Windows 自绘标题栏关闭按钮（X）当前直接 `getCurrentWindow().close()`，误触会立刻退出应用。用户要求 **每次关闭都二次确认**，且实现必须 **隔离**，不得改变 macOS（hide-on-close）、Linux 或其它系统菜单/退出路径。

## 目标与边界

- Windows 主窗口标题栏 **X** 点击：每次弹出确认；确认后才关闭；取消不关闭。
- 确认逻辑抽成独立模块，仅 Windows `WindowControls` 调用。
- macOS / Linux / 原生菜单 `file_close_window` / `window_close` / `file_quit` / Alt+F4 本 change **不改**（隔离边界）。

## 非目标

- 不按「有无运行中会话」条件确认（产品要求：每次都弹）。
- 不改 macOS `CloseRequested` → hide 行为。
- 不改 Rust `menu.rs` 退出路径。
- 不引入设置开关 / 「不再询问」。
- 本 change **不自动 git commit**（交用户验收后提交）。

## What Changes

- 新增 `windowsMainWindowCloseConfirm.ts`：打开门闩 + `performWindowsMainWindowClose`（可测）。
- 新增 `WindowsMainWindowCloseConfirmDialog`：自定义 `AlertDialog`（**不用**系统 Win / plugin-dialog）。
- Windows `WindowControls`：X → 自定义确认 → 确认后 close；连点不叠 dialog。
- i18n：`menu.closeWindowConfirm*` + `{{appName}}` + busy 文案（en / zh）。
- 单测：helper + dialog + 标题栏确认/取消/连点。
- OpenSpec capability：`windows-main-window-close-confirm`。

## 方案取舍

- **方案 A（采用）**：仅前端拦截 Windows 自绘 X + 隔离 helper + **布局内自定义 AlertDialog**。最小面、不碰其它 OS、非系统对话框。
- **方案 B（不采用）**：Rust `CloseRequested` 全拦截。会波及菜单/Alt+F4，隔离成本高。
- **方案 C（不采用）**：`plugin-dialog` 系统 confirm。用户明确不要默认 Win 对话框。

## Capabilities

### New Capabilities

- `windows-main-window-close-confirm`：Windows 主窗自绘关闭按钮必须先二次确认再执行 close。

### Modified Capabilities

<!-- 无 -->

## Impact

- Frontend: `src/features/layout/utils/windowsMainWindowCloseConfirm.ts`（新）
- Frontend: `src/features/layout/components/SidebarToggleControls.tsx`（WindowControls 仅）
- i18n: `en/menu.ts`, `zh/menu.ts`
- Tests: helper + SidebarToggleControls
- Rust / menu / macOS chrome: **无**

## 验收标准

- Win：点 X → 弹确认 → 取消仍开着；确认后窗口关闭。
- 单测：确认/取消/confirm 失败均不误关；标题栏集成测通过。
- macOS 代码路径无新增 import 该 helper（仅 Windows WindowControls 引用）。
- OpenSpec artifacts 齐全；**不 git commit**（本轮）。
