## 1. 隔离确认流程

- [x] 1.1 `canOpenWindowsMainWindowCloseConfirm` + `performWindowsMainWindowClose`（close-failed + log）
- [x] 1.2 单测：门闩 / closed / close-failed

## 2. 自定义对话框 + Windows 标题栏

- [x] 2.1 `WindowsMainWindowCloseConfirmDialog`（AlertDialog，非系统 dialog）
- [x] 2.2 `WindowControls`：X 开门闩 → 自定义确认 → close；连点不叠
- [x] 2.3 仅 Win 路径；不改 macOS / menu / Rust
- [x] 2.4 en/zh i18n：`{{appName}}` + busy

## 3. 回归

- [x] 3.1 标题栏：确认 close / 取消 / 连点
- [x] 3.2 dialog 组件测
- [x] 3.3 focused vitest 通过

## 4. OpenSpec

- [x] 4.1 proposal / design / tasks / spec delta（含自定义 dialog）
- [x] 4.2 `openspec/changes/README.md` active 表
- [x] 4.3 用户 Win 本机点 X 冒烟验收通过（2026-08-05）；archive 可另排
