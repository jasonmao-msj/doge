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


## Session 12: 移除按量付费用户心智

**Date**: 2026-08-16
**Task**: 移除按量付费用户心智
**Branch**: `codex/remove-payg-mental-model`

### Summary

删除账号套餐提示中的按量付费概念，只保留服务端实时套餐事实，并加入中英文产品文案防回归测试。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `b46a202bf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 13: 统一 Windows 校验文件换行

**Date**: 2026-08-16
**Task**: 统一 Windows 校验文件换行
**Branch**: `codex/windows-checksum-lf`

### Summary

修复 GitHub Windows artifact 的 SHA-256 sidecar 使用 CRLF 导致 Unix shasum -c 无法读取的问题，改为 BOM-free ASCII + LF，并加入 release workflow contract。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `36f5f8dd2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 14: 生成可移植 macOS 校验文件

**Date**: 2026-08-16
**Task**: 生成可移植 macOS 校验文件
**Branch**: `codex/macos-portable-checksum`

### Summary

修复 macOS artifact SHA-256 sidecar 记录 CI release-artifacts 路径的问题，改为仅记录 basename，并加入 release workflow contract。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `508425f81` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 15: 修复 macOS 嵌套签名顺序

**Date**: 2026-08-16
**Task**: 修复 macOS 嵌套签名顺序
**Branch**: `codex/macos-sign-nested-first`

### Summary

根据 Intel CI 失败日志，将 OpenSSL dylib、daemon、main、App 的签名顺序固定为由内到外；同时覆盖 ad-hoc 与 Developer ID 路径，并加入顺序 contract。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2f672fc67` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 16: 验证 Windows 应用启动

**Date**: 2026-08-16
**Task**: 验证 Windows 应用启动
**Branch**: `codex/windows-launch-smoke`

### Summary

在 Windows artifact-only job 中启动 doge.exe 8 秒、断言进程存活并清理主进程与 daemon；加入 release workflow contract。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7a9d9b3cb` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 17: 记录跨平台发布证据

**Date**: 2026-08-16
**Task**: 记录跨平台发布证据
**Branch**: `codex/account-release-evidence`

### Summary

记录最终 macOS arm64/x86_64 与 Windows x64 GitHub runs、checksums、架构、签名、依赖和启动 smoke；保留 controlled-account 与人工视觉 gate 未完成事实。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2693045ae` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 18: 修复账号恢复脱敏邮箱误判并验证本地包

**Date**: 2026-08-16
**Task**: 修复账号恢复脱敏邮箱误判并验证本地包
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

修复 masked primaryEmailLabel 被通用 SafeLabel 拒绝导致服务暂时不可用的问题；新增 exact IPC bootstrap 回归测试，更新 OpenSpec/Trellis contract，并完成 macOS arm64 DMG 构建、签名校验与真实会话恢复冒烟。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `520a19ade` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 19: 补全支付恢复退出动线并生成本地包

**Date**: 2026-08-16
**Task**: 补全支付恢复退出动线并生成本地包
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

为 recovered checkout 增加返回套餐与退出登录；新增 account/device/checkout-scoped 本地 checkpoint abandon，logout 清理旧 checkpoint；补齐跨层测试与 OpenSpec/Trellis contract，并生成且验证 macOS arm64 DMG。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f8cc2082b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 20: 补全无订阅账号退出入口并重新打包

**Date**: 2026-08-16
**Task**: 补全无订阅账号退出入口并重新打包
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

将退出登录提升为 authenticated AccountAppGate 的统一逃生口，覆盖套餐、空态、加载、异常、支付与准备状态；补齐 pending/失败/stale checkout 回归，更新 OpenSpec 与 Trellis contract，完成全量 1098 文件测试并生成验证 macOS arm64 DMG。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `af809d10b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 21: 修复退出登录永久连接竞态

**Date**: 2026-08-16
**Task**: 修复退出登录永久连接竞态
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

定位 logout 本地 sessionChanged 触发 bootstrap 后被 generation 作废但 loading 未释放的竞态；用 exact loading generation owner 修复 logout/change-password signed-out 收敛，新增 deferred event 回归测试并同步 OpenSpec/Trellis contract。验证 focused 28 tests、全量 1098 test files、typecheck、lint 0 errors、Rust account 73 tests、OpenSpec strict、runtime contracts/doctor；macOS arm64 DMG 已通过 hdiutil、deep codesign、Mach-O/OpenSSL 与 8 秒启动 smoke，Windows x64 artifact 待同 commit CI 构建。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `fe5a70b82` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 22: 完成双平台本地试用包交付

**Date**: 2026-08-16
**Task**: 完成双平台本地试用包交付
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

完成 task 6.9 双平台交付闭环：macOS arm64 DMG 通过 hdiutil verify、deep codesign、Mach-O/OpenSSL 和 8 秒启动 smoke；Windows x64 unsigned NSIS 在 GitHub windows-latest 对同一修复 commit 构建，doge.exe 启动 smoke、artifact upload 与本地 SHA-256 复核通过。交付目录 release-local/fix-logout-loading-20260816。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c37cf1c27` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 23: 清理引擎界面并加固桌面启动

**Date**: 2026-08-16
**Task**: 清理引擎界面并加固桌面启动
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

删除古诗词轮换与相关持久化/测试，统一面向用户的简洁引擎名称和引擎管理文案；二维码使用当前选中套餐名；外部 engine probe 增加 4 秒 deadline、进程树清理和 single-instance 唤醒。focused tests、typecheck、Rust check、OpenSpec validate 通过并生成验证 macOS arm64 DMG；token2api 改动保持独立 worktree 未提交未发布，Windows 本地包受 macOS host gate 限制。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `31498df79` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 24: 打通第二引擎订阅闭环并生成 macOS 体验包

**Date**: 2026-08-16
**Task**: 打通第二引擎订阅闭环并生成 macOS 体验包
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

实现 Codex 已订阅用户在应用内选择 Claude、查看订阅套餐、支付后自动准备凭据与配置并进入 Claude 新会话的闭环；保留原 AppShell 上下文和取消返回能力，补充 entitlement store、事件契约、多语言文案、focused regression 与 OpenSpec/Trellis executable contract；相关测试、typecheck、lint、runtime/engine contract gates、OpenSpec strict validate 均通过，并生成校验有效的 macOS arm64 DMG。token2api 未修改。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `177720cc1` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 25: 完善账号多订阅用量与 Keychain 恢复

**Date**: 2026-08-17
**Task**: 完善账号多订阅用量与 Keychain 恢复
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

实现多订阅额度/安全中心与年度用量视图，扩展账号 usage contract 和 mock/native projection，并将 macOS 冷启动 vault 访问收敛为一次状态检查、一次 refresh 读取和一次轮换写入。验证：lint/typecheck、账号前端 65/65、Rust account 76/76、runtime/release contracts、OpenSpec strict 均通过；全量测试因未修改的 pricing fixture 时间漂移在第 67/274 批次出现 3 个 stale 断言失败。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8e8b165c4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 26: 内置订阅引擎与版本选择

**Date**: 2026-08-17
**Task**: 内置订阅引擎与版本选择
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

将 Codex 0.147.0 与 Claude Code 2.1.233 按平台打包进安装器；账号启动按本机版本静默复用或提示选择，不覆盖用户安装；隔离 account provider runtime binary，修复 Windows current-user 配置替换与稳定错误；完成前后端 focused tests、Rust account suite、macOS arm64 DMG 构建和签名/架构校验。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `40f9ee78e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 27: 加固 Windows artifact 构建入口

**Date**: 2026-08-17
**Task**: 加固 Windows artifact 构建入口
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

GitHub hosted runner 连续因第三方 action codeload 429/502 在 setup 阶段失败；Windows artifact-only job 改用 runner 预装 rustup stable，移除非必要 rust-cache 与 sccache third-party actions，降低发布链外部故障点，不改应用代码。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `76007cc53` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 28: 修复 Windows 跨卷引擎打包

**Date**: 2026-08-17
**Task**: 修复 Windows 跨卷引擎打包
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

真实 Windows runner 发现 TEMP 位于 C 盘、workspace 位于 D 盘，OS temp staging 到 generated resources 的 rename 返回 EXDEV；最终 stage 改为 output sibling same-volume atomic rename，增加回归测试与 OpenSpec/Trellis contract。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e06a03bc0` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 29: 记录双平台内置引擎产物

**Date**: 2026-08-17
**Task**: 记录双平台内置引擎产物
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

回写 macOS arm64 与真实 Windows x64 bundled-engine release evidence；Windows runner 通过 NSIS current-user bundle、existing-target regression、8 秒启动 smoke 与 artifact 上传，完成 OpenSpec 双平台验证任务。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `1540773b1` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 30: 记录 token2api 生产发布证据

**Date**: 2026-08-17
**Task**: 记录 token2api 生产发布证据
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

token2api PR #44/#45 已合并并发布 production image 1b6bae8eb；补齐 Doge OpenSpec 的 immutable artifact、PostgreSQL backup、EBS snapshot、SSM deploy/verify 与 health evidence，并完成任务 6.22。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c67c997a3` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 31: 记录 Shared 会话额度投影问题

**Date**: 2026-08-17
**Task**: 记录 Shared 会话额度投影问题
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

记录用户反馈：Shared Session Composer quota panel 识别到 Token Matrix 套餐供应商但显示 provider empty、无额度窗口；新增 OpenSpec change fix-shared-session-subscription-quota-projection，定义 target-scoped authority quota、状态区分与后续验收，暂不修改运行时代码或 token2api。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `83fdbab1e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 32: 收口账号订阅额度与引擎默认流程

**Date**: 2026-08-19
**Task**: 收口账号订阅额度与引擎默认流程
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

完成账号中心订阅与额度交互、账号快捷入口、托管引擎默认配置、额度请求刷新回归测试及跨层 contract 更新；排除 Trellis 执行中间文档，不纳入代码提交。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6e649e5ac` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 33: 恢复新会话托管渠道默认并建立分层测试

**Date**: 2026-08-20
**Task**: 恢复新会话托管渠道默认并建立分层测试
**Branch**: `codex/fix-account-masked-email-bootstrap`

### Summary

新建会话按各引擎订阅默认使用 Doge Token Matrix；同引擎 local/manual 切到托管渠道前重新 prepare 原生凭据；建立 L0-L4 按影响面验证规则。L3 focused tests、typecheck、targeted ESLint 与 strict OpenSpec 已通过，L4 交由 PR/Release CI。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `3865ba37b` | (see git log) |
| `2e3bd5db2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 34: 修复本地开发钥匙串重复弹窗并接入稳定签名链路

**Date**: 2026-08-23
**Task**: macOS 免钥匙串弹窗开发启动
**Branch**: `codex/fix-managed-provider-session-defaults`

### Summary

诊断确认 dev 产物为 ad-hoc linker-signed，每次重编译 cdhash 变化导致 login Keychain 中 `com.doge.account` 凭据的 ACL 授权失效，启动读取凭据时重复弹密码框。接入仓库已有的稳定自签身份链路：`tauri dev --runner` 包装 cargo，经 `CARGO_TARGET_*_RUNNER` 在产物 exec 前用 `Doge Local Development` 身份签名；本机身份已就绪并对 `target/debug/doge` 完成非交互签名验证（稳定 identifier + Internal Requirements DR）。README 记录启动方式与首次「始终允许」步骤。

### Main Changes

- package.json 新增 `tauri:dev:hot:signed:mac`（setup 幂等 + `tauri dev --runner scripts/macos-dev-signed-cargo.sh`）
- 纳管 `scripts/setup-macos-dev-signing.sh`、`scripts/macos-dev-signed-cargo.sh`、`scripts/macos-dev-signed-runner.sh` 与 contract test
- `README.zh-CN.md` 本地开发新增「macOS 免钥匙串弹窗启动」

### Git Commits

| Hash | Message |
|------|---------|
| `b34b8f9ee` | build(dev): 接入稳定签名开发链路避免钥匙串重复授权弹窗 |
| `798a02510` | docs(readme): 记录 macOS 免钥匙串弹窗开发启动方式 |

### Testing

- [OK] L1（dev 工具脚本 + 文档，无应用代码路径）：contract test 通过；`tauri --runner` 语义经假 runner 探针确认（替换 cargo 程序调用）；非交互 codesign + `--verify --strict` 通过；签名元数据确认稳定 identifier 与 Internal Requirements
- [PENDING] 首次 GUI 启动点击「始终允许」由用户执行

### Status

[OK] **Completed**

### Next Steps

- 用户首次 `npm run tauri:dev:hot:signed:mac` 时在钥匙串弹窗选择「始终允许」，此后重编译不再弹窗


## Session 34: 统一订阅、动态模型与账户详情验收

**Date**: 2026-08-23
**Task**: 统一订阅、动态模型与账户详情验收
**Branch**: `codex/fix-managed-provider-session-defaults`

### Summary

完成 product-scoped 统一订阅、macOS debug local vault、Kimi 托管链路、三引擎自动 provisioning、动态模型目录与 Composer 组合选择、原型化渐进账户详情；完成 L4 JS/Rust/build/contract 验证并记录 token2api production route 与锁屏目视阻塞。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `b639fb8a7` | (see git log) |
| `4f5c41737` | (see git log) |
| `92ef3e99d` | (see git log) |
| `90461be7a` | (see git log) |
| `fc4d87876` | (see git log) |
| `7fcbd565c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 35: 统一订阅 PR 交付

**Date**: 2026-08-23
**Task**: 统一订阅 PR 交付
**Branch**: `codex/fix-managed-provider-session-defaults`

### Summary

创建未合并 PR #1124 并回写 OpenSpec 交付状态；production 路由和 macOS 锁屏目视验收仍作为显式 blocker，task 保持 active。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `94ee6d38f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
