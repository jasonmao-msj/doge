# Journal - jason (Part 1)

> AI development session journal
> Started: 2026-08-10

---



## Session 1: 修复重品牌前上游基线

**Date**: 2026-08-10
**Task**: 修复重品牌前上游基线
**Branch**: `chore/rebrand-client-to-doge`

### Summary

完成 Fork 开发基线清障：修复前端与 Rust 门禁漂移及消息附件、超时 sentinel、Windows 缩放残留等缺陷；runtime contracts、lint、typecheck、1,074 个前端测试文件和 Rust 全套验证通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7f37c1339` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: 迁移 doge 客户端品牌与兼容边界

**Date**: 2026-08-10
**Task**: 迁移 doge 客户端品牌与兼容边界
**Branch**: `chore/rebrand-client-to-doge`

### Summary

完成 doge 客户端跨层品牌迁移、上游服务隔离、兼容数据迁移、视觉资产、文档治理与本地 ARM64 unsigned artifact 验证；签名更新链、跨平台 CI 与锁屏后的原生页面冒烟仍保持未完成。

### Main Changes

- 建立 `config/brand.json` canonical identity，并将 npm、Cargo、Tauri、daemon、UI、10 套 locale、README/current docs 和平台资产迁移到 lowercase doge。
- 移除 Baidu analytics 与上游 managed relay，替换产品链接；updater 清空上游 endpoint/public key 并保持 release fail-closed。
- 实现 `~/.doge`、bundle app-data、localStorage/client-store 与 serialized marker 的 copy-forward/dual-read/new-write 迁移。
- 生成并接入 Concept A AI 柴犬图标、全平台 icon matrix 与 doge DMG 视觉。
- 新增品牌、服务、迁移、release、icon、upstream-sync 契约与三份 Trellis 可执行规范。
- 实机启动发现并修复 updater 空配置崩溃；ARM64 release 构建发现并修复 daemon source-stem sidecar 漏项、DMG AppleScript 无限等待及 unsigned OpenSSL 宿主路径问题。


### Git Commits

| Hash | Message |
|------|---------|
| `e41bd18f9` | (see git log) |

### Testing

- [OK] Frontend segmented full inventory：1,074/1,074 files，9,005 passed，2 intentional skipped，0 unresolved failures。
- [OK] `cargo test --manifest-path src-tauri/Cargo.toml`：2,006 lib + 1,139 daemon + 92 integration，0 failures。
- [OK] lint 0 errors（16 baseline warnings）、typecheck、production frontend build、branding/docs/icon/upstream/runtime/doctor/OpenSpec gates。
- [OK] ARM64 unsigned `doge.app` / DMG：bundle id、arm64 binaries/dylibs、`@rpath`、DMG checksum 与 mounted contents 验证通过。
- [PARTIAL] debug `target/debug/doge` 成功启动；macOS 锁屏阻止 computer-use 页面/菜单点击验收。

### Status

[PARTIAL] **Implementation committed; change remains open for release credentials and platform smoke.**

### Next Steps

- 解锁 Mac 后完成 title/menu/Home/Settings/About/update-disabled 原生 UI 冒烟与截图。
- 安装完整 Xcode，配置 Developer ID/notarization 与独立 doge updater key；完成 signed release 和两版本更新验收。
- 通过 GitHub Actions 验证 Windows/Linux artifacts；未满足前不 archive OpenSpec change。


## Session 3: Computer Use 完成 doge 实机品牌验收

**Date**: 2026-08-10
**Task**: Computer Use 完成 doge 实机品牌验收
**Branch**: `chore/rebrand-client-to-doge`

### Summary

在 macOS debug bundle 中核对窗口、Home、Settings、Community、更新失败关闭状态与原生菜单；发现并移除上游公众号/微信群二维码，改为 doge 品牌故事及 canonical GitHub/Issues 入口，补 45 项 focused 回归与 OpenSpec 证据。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `de0aa7f47` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: 增加 Windows artifact-only 构建通道

**Date**: 2026-08-10
**Task**: 增加 Windows artifact-only 构建通道
**Branch**: `chore/rebrand-client-to-doge`

### Summary

为现有 Release workflow 增加 windows_artifact_only 手动模式：Windows runner 生成 unsigned doge NSIS 与 SHA-256，只读权限且不访问 release secrets、不发布 Release/latest.json；补 workflow contract 与 OpenSpec/Trellis release isolation 规范。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `21b3f251c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: 产出并校验 Windows NSIS 安装包

**Date**: 2026-08-10
**Task**: 产出并校验 Windows NSIS 安装包
**Branch**: `chore/rebrand-client-to-doge`

### Summary

GitHub Actions run 31449894326 在 windows-latest 成功生成 unsigned doge_0.1.0_x64-setup.exe；下载到 release-local/windows，校验 27,981,697 bytes 与 SHA-256 859b683d2aabf8ed4813750901e1d385d25d840b7413dd0ec37ad8f278691bce，并写回 OpenSpec verification。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `15a51b01a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: 实现每日诗词轮换提示

**Date**: 2026-08-10
**Task**: 实现每日诗词轮换提示
**Branch**: `feat/daily-poetry-composer-banner`

### Summary

将输入框开源提示替换为带作者和篇名的每日中国古诗词；内置 30 条固定池，按本地日期确定性轮换，连续 30 天不重复并在第 31 天开启新循环；支持当天关闭、次日恢复，补齐组件、存储、轮换单元测试与 OpenSpec/Trellis 文档。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c8eb452db` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: macOS 内部安装包工作流

**Date**: 2026-08-10
**Task**: macOS 内部安装包工作流
**Branch**: `ci/macos-artifact-only`

### Summary

新增 Apple Silicon 与 Intel 无签名 DMG artifact-only workflow；保持正式发布 fail-closed，并补齐 release contract、Trellis 规范与 OpenSpec delta。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8b1a5bc13` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: 合并并行 main 进展

**Date**: 2026-08-10
**Task**: 合并并行 main 进展
**Branch**: `ci/macos-artifact-only`

### Summary

语义合并每日诗词 PR 与 macOS artifact-only 分支的 Trellis 记录，保留双方 session history，并复跑发布契约、typecheck、docs 与 OpenSpec。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8b462e062` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: 默认合并构建桌面安装包

**Date**: 2026-08-10
**Task**: 默认合并构建桌面安装包
**Branch**: `ci/default-combined-installers`

### Summary

将手动 Release workflow 默认设置为同一 run 并行构建 macOS 与 Windows internal artifacts；单平台仅用于明确请求或 targeted retry，并用 Trellis/OpenSpec 与 contract 固化规则。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2b78bee46` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: 固定 doge 单一应用图标

**Date**: 2026-08-11
**Task**: 固定 doge 单一应用图标
**Branch**: `fix/hide-app-icon-switcher`

### Summary

隐藏设置页应用图标切换器，移除专用 UI/CSS；将历史 dockIconId 统一归一为 default 并固定使用 canonical doge 柴犬图标；补充品牌契约与回归测试，完成 1078 个前端测试文件、类型检查、lint、品牌/图标/OpenSpec 门禁和生产构建验证。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `1bf44af01` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: 实现订阅制引擎启动闭环

**Date**: 2026-08-16
**Task**: 实现订阅制引擎启动闭环
**Branch**: `codex/require-account-engine-subscription-onboarding`

### Summary

完成强制登录、引擎选择、服务端公开订阅套餐、checkout 与托管凭据自动配置闭环；接入密码找回请求，补齐跨层测试、OpenSpec/Trellis 规范和 macOS/Windows artifact-only release workflow。token2api 已在 AWS 运行合并 commit 3677f53d。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c8f85ee1a` | (see git log) |

### Testing

- [OK] 1097/1097 frontend test files，Rust 2076 pass，typecheck/lint/runtime/OpenSpec/release contracts pass

### Status

[OK] **Completed**

### Next Steps

- GitHub PR 与 macOS/Windows artifact-only CI
