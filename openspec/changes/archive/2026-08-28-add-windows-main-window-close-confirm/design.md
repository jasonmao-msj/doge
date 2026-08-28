## Context

- Windows 主窗 `decorations(false)`，关闭 X 在前端 `WindowControls`（`SidebarToggleControls.tsx`）。
- 旧实现：`handleClose` → `getCurrentWindow().close()`，无确认。
- macOS：Rust `CloseRequested` → `prevent_close` + `hide()`，与 Win 退出语义不同，禁止混改。

## Goals / Non-Goals

**Goals**

- 每次点 Win 标题栏 X 都二次确认。
- 确认逻辑可单测、可注入依赖（无 Tauri 也能测）。
- 调用面仅 Windows WindowControls。

**Non-Goals**

- Alt+F4 / 任务栏关闭 / 系统菜单退出统一拦截。
- macOS hide-on-close 改造。
- 条件确认、偏好持久化。

## Decisions

### 1. 隔离模块

`src/features/layout/utils/windowsMainWindowCloseConfirm.ts`：

```ts
requestWindowsMainWindowClose(labels, { confirm, close })
// → "confirmed" | "cancelled" | "confirm-failed"
```

- `confirm` 失败或返回 false → **不**调用 `close`（fail closed）。
- UI 层只组装 i18n labels + Tauri `confirm` + `getCurrentWindow().close`。

### 2. 对话框宿主（自定义，不用系统 Win 对话框）

使用仓库内 `AlertDialog`（`WindowsMainWindowCloseConfirmDialog`），与 FileTree 的 native `plugin-dialog` **分离**：

- 视觉与交互跟客户端一致（modalLayer、主题 token）。
- 不调用 `@tauri-apps/plugin-dialog` confirm（避免 Windows 系统默认对话框）。
- 连点防护：`canOpenWindowsMainWindowCloseConfirm({ isDialogOpen, isClosing })`。
- 关闭 API 失败：`performWindowsMainWindowClose` 返回 `close-failed` 并 `console.warn`，不静默吞错。

### 3. 平台边界

| 入口 | 本 change |
|------|-----------|
| Win 自绘 X | 确认后 close |
| Win 菜单 close / quit | 不变 |
| macOS 红绿灯 / CloseRequested | 不变 |
| Linux | 不变（无此自绘控件） |

`WindowControls` 仅由 `TitlebarExpandControls` 在 `isWindowsPlatform()` 为 true 时渲染，天然平台隔离。

### 4. i18n

新增 keys（en / zh 手写；其它 locale 走 fallback / 后续 build-locale）：

- `menu.closeWindowConfirmTitle`
- `menu.closeWindowConfirmMessage`
- `menu.closeWindowConfirmOk`
- `menu.closeWindowConfirmCancel`

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 用户嫌每次确认烦 | 产品明确要求；后续可再加设置（新 change） |
| Alt+F4 仍无确认 | 文档写清隔离边界；若要统一需 Rust 拦截（另提案） |
| confirm plugin 不可用 | fail closed，不关闭窗口 |

## Implementation map

| 文件 | 职责 |
|------|------|
| `windowsMainWindowCloseConfirm.ts` | 纯确认→关闭流程 |
| `windowsMainWindowCloseConfirm.test.ts` | 确认/取消/失败 |
| `SidebarToggleControls.tsx` | WindowControls.handleClose 接线 |
| `SidebarToggleControls.test.tsx` | 点击 X 确认/取消 |
| `en/menu.ts` / `zh/menu.ts` | 文案 |
