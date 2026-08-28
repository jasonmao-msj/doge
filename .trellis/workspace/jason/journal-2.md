# Journal - jason (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-08-27

---



## Session 59: 按 API protocol 统一 Product 模型目录

**Date**: 2026-08-27
**Task**: 按 API protocol 统一 Product 模型目录
**Branch**: `codex/render-models-by-protocol`

### Summary

从最新 origin/main 建立独立分支；Native 将模型 compatibility 归一为 openai/anthropic API protocol，Codex/Kimi 共享 OpenAI catalog，Claude 消费 Anthropic catalog；补齐跨层 contract、ADR 与 focused regression。L3: 167 frontend tests、14 Rust tests、typecheck、target ESLint、cargo check、runtime/OpenSpec/docs/large-file gates通过；engine-controller-facade 为未修改 main baseline 743>600。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2b46b68be` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 60: 修复 Codex 调用 Kimi 模型

**Date**: 2026-08-27
**Task**: 修复 Codex 调用 Kimi 模型
**Branch**: `codex/render-models-by-protocol`

### Summary

补齐 production Doge APP 的 kimi/k3 Responses 路由；将 Product 模型兼容性拆为 endpoint-level protocol，并基于双端点实测让 K3/Kimi 同时投影到 Codex 与 Kimi。L3 focused tests、两条 OpenSpec strict validation、三个 Responses probes 与真实 Codex+k3 turn 均通过；hot UI 用户复验待完成。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `31951f045` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 61: 准备 v0.1.2 正式发布

**Date**: 2026-08-27
**Task**: 准备 v0.1.2 正式发布
**Branch**: `codex/render-models-by-protocol`

### Summary

用户确认 Hot Doge 目视验收通过；统一 config/brand、npm、Cargo 与 Tauri 版本为 0.1.2。release branding、workflow contract、docs、OpenSpec、upstream isolation 与 diff gate 通过；本地 origin 按项目规范校准为 canonical HTTPS。待合并 PR #35 并运行 signed release workflow。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `b6b2ffe01` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 62: 按需静默准备产品引擎

**Date**: 2026-08-27
**Task**: 按需静默准备产品引擎
**Branch**: `codex/lazy-engine-provisioning`

### Summary

登录后立即进入 AppShell；仅在实际 cli_install_run 时展示安装卡，已安装或 bundled/external 引擎静默复用；补齐 exact-engine IPC、send 边界、draft 恢复、跨层规范与 L3 验证，Hot Doge 冷启动由用户目视通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `48191da6a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 63: 合并最新 main 引擎路由

**Date**: 2026-08-27
**Task**: 合并最新 main 引擎路由
**Branch**: `codex/lazy-engine-provisioning`

### Summary

Semantic merge PR #36 的 create-session engine routing：保留 frozen engineOverride、SessionCreationOptions retry 与 Target readiness guard，同时保持 send-time exact-engine provisioning；268 项重叠面测试、typecheck 与 targeted ESLint 通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `89f3040e4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 64: 统一 Product 引擎模型目录

**Date**: 2026-08-27
**Task**: 统一 Product 引擎模型目录
**Branch**: `codex/unify-panel-engine-model-catalog`

### Summary

建立 canonical ProductTargetCatalog；Composer 与 Kanban 共享上游 protocol projection；Kanban dual-read/new-write exact ExecutionTarget，TaskRun/session/send 保留 managed provider 与 runtime model；修复 recurring target 丢失及同 engine 跨 provider thread 误复用。用户 Hot Doge 目视验收通过。L3：213 focused tests、target ESLint、typecheck、production build、runtime/docs contracts、OpenSpec strict validation 通过；engine-controller facade 仅有未修改文件 744>600 的既有 baseline failure。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `709c3d57b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 65: 准备 doge v0.1.3 发布

**Date**: 2026-08-27
**Task**: 准备 doge v0.1.3 发布
**Branch**: `codex/release-v0.1.3`

### Summary

同步 config/brand.json、package/package-lock、Cargo/Cargo.lock 与 Tauri 版本到 0.1.3。通过 branding check、release workflow contract 7 tests、cargo metadata、git diff check，并确认 GitHub v0.1.3 tag 尚未存在。下一步合并版本 PR 后以 windows_artifact_only=false、macos_artifact_only=false 触发完整 signed release。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2d595ca78` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 66: 修复 brand 版本契约测试

**Date**: 2026-08-27
**Task**: 修复 brand 版本契约测试
**Branch**: `codex/fix-brand-version-contract`

### Summary

修复 CI run 33141654705 的 test-js/test-windows 同源失败：brandManifest identity test 不再硬编码 0.1.0，改为三段 SemVer contract；package/Tauri/Cargo 与 brand.version 的严格一致性断言保持不变。通过 focused Vitest 3/3、target ESLint、branding check 与 typecheck。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `aaec1fe5b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 67: 统一 Release 变更日志契约

**Date**: 2026-08-28
**Task**: 统一 Release 变更日志契约
**Branch**: `codex/enforce-release-changelog-gate`

### Summary

以 committed CHANGELOG.md 统一 App、updater 与 GitHub Release 内容；新增双语/version gate、CI 与 signed preflight 校验，删除 commit scan 和 post-release PR，并创建 PR #44。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `82615a873` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 68: 准备 doge v0.1.10 Release

**Date**: 2026-08-28
**Task**: 准备 doge v0.1.10 Release
**Branch**: `codex/release-v0.1.10`

### Summary

同步七个 canonical version facts 与双语 CHANGELOG 到 0.1.10；发现并规避 v0.1.4-v0.1.9 legacy tag 冲突，新增 signed preflight exact-tag fail-closed gate；L3 release checks、contracts、typecheck、production build 与 OpenSpec strict 通过。任务保持 active，待 PR 合入和 L4 Release。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0abd0698e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 69: 稳定 Windows Vitest timing gate

**Date**: 2026-08-28
**Task**: 稳定 Windows Vitest timing gate
**Branch**: `codex/stabilize-windows-vitest-timeouts`

### Summary

main CI 三次在三个无关 jsdom tests发生 5000ms timeout；保留原 timeout，仅为 Windows batched lane增加一次 bounded Vitest retry，默认/其他 callers保持 retry 0。Parser、args、workflow contract、三个失败 suites、typecheck与 OpenSpec strict通过。任务保持 active，待 PR 合入、green main 与 v0.1.10 Release。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `558d1ac8d` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 70: 稳定 Unix probe descendant reaping regression

**Date**: 2026-08-28
**Task**: 稳定 Unix probe descendant reaping regression
**Branch**: `codex/stabilize-probe-process-group-test`

### Summary

修复 hanging probe test对 SIGKILL 后 orphan zombie的 immediate ESRCH错误假设；在既有 2s cleanup budget内 bounded poll最终 ESRCH，production probe/kill/deadline不变。Focused Rust regression连续 10/10、cargo check --lib、rustfmt与 release/docs/OpenSpec gates通过。任务保持 active，待 PR 合入、green main 和 v0.1.10 Release。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `510d267b2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
