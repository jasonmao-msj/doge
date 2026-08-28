## 1. Diagnose

- [x] 1.1 读取 Windows failure，确认 timeout 位于 full `ProjectMapPanel` mount，而非 assertion async settlement。
- [x] 1.2 核对 path/explanation pure helpers 已有独立 coverage。

## 2. Focused test migration

- [x] 2.1 将 disclosure behavior 移到 `ProjectMapNavigationPanel.test.tsx`。
- [x] 2.2 保留 default collapsed、click expanded、relation reason visible assertions。
- [x] 2.3 运行 L2 focused tests、ESLint、typecheck 与 strict OpenSpec。

## 3. Delivery and artifacts

- [x] 3.1 commit、Trellis record、push branch并创建 PR #26。
- [x] 3.2 dispatch release workflow：Windows unsigned NSIS + macOS aarch64/x86_64 ad-hoc DMG。
- [x] 3.3 由 `gpt-5.6-luna` subagent 监控 release workflow terminal state并提取 artifacts。
