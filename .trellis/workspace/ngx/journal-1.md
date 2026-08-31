# Journal - ngx (Part 1)

> AI development session journal
> Started: 2026-08-25

---



## Session 2: 修复 Codex managed CLI 检测与首页路由

**Date**: 2026-08-25
**Task**: 修复 Codex managed CLI 检测与首页路由
**Branch**: `codex/fix-codex-managed-routing`

### Summary

完成 Codex、Claude Code、Kimi 的 bundled/external managed toolchain 接入；修复 bundled Codex 被 generic PATH probe 误判未安装，以及 Home 显式选择 Codex 后首条消息在异步 activation 期间回落 Claude。

### Main Changes

- Tauri 增加 managed toolchain inspect/activate IPC、bundled manifest 解析、Kimi binary override 与 isolated runtime binding。
- Kimi 改为从 bundled manifest provisioning，其他引擎继续保持既有 detection/installer 行为。
- 前端 availability 只对 verified ready 的 managed Codex 覆盖 generic 状态，其他引擎状态保持原检测逻辑。
- Composer 保存用户显式的 creation target，首条消息使用冻结的 Codex target。
- 修复 Windows Tauri dev CLI 启动方式，补齐 engine switch、CLI version status、provisioning、availability 与 Composer regression tests。
- 同步 OpenSpec design、Trellis backend contract 与 multi-CLI foundation ADR calibration。

### Git Commits

| Hash | Message |
|------|---------|
| `c661f0162` | (see git log) |

### Testing

- [OK] Focused Vitest：9 files / 131 tests passed
- [OK] `npm run typecheck`
- [OK] `npm run check:runtime-contracts`
- [OK] `npm run check:engine-adapter-registry`
- [OK] `npm run check:docs`
- [OK] `openspec validate doge-unified-product-subscription --strict --no-interactive`
- [WARN] `check:engine-capability-matrix` 仍受既有 generated artifact drift 影响；定向 ESLint 保留 2 个既有 dependency warnings；`cargo check` 受运行中的 Doge 进程锁定 bundled resource 影响。

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: 启用 doge 远端更新并归档 OpenSpec

**Date**: 2026-08-26
**Task**: 启用 doge 远端更新并归档 OpenSpec
**Branch**: `codex/enable-doge-updater`

### Summary

(Add summary)

### Main Changes

本次完成 doge Tauri 远端更新能力，并归档对应 OpenSpec change。

**代码提交**:
- `09692cd2f feat(updater): 启用 doge 远端更新`
- `dd3bf2e32 chore(openspec): 归档远端更新变更`

**实现内容**:
- 启用 Tauri updater，配置 canonical feed：`https://github.com/jasonmao-msj/doge/releases/latest/download/latest.json`
- 固化用户提供的 updater public key；signing private key 与 password 仅通过 GitHub Actions secrets 注入，不进入仓库。
- release workflow 增加 signing preflight、Windows/macOS updater artifact 签名及 `latest.json` 校验。
- artifact-only workflow 自动关闭 updater artifacts，避免没有 signing secret 时误失败。
- 增加 updater focused tests，并修复 Windows CRLF 下 release contract test 误报。
- 修复更新下载期间 dismiss、重复点击和 stale continuation 行为。

**验证**:
- L3 verification passed：35 个 focused Vitest tests、targeted ESLint、`npm run typecheck`、`cargo check --manifest-path src-tauri/Cargo.toml --lib`、release workflow contract tests、branding check、OpenSpec strict validation、`git diff --check`。
- 全量 `openspec validate --specs` 仍有 4 个既有无关失败：`app-shortcuts`、`composer-note-card`、`spec-hub-workbench-ui`、`workspace-note-card-pool`。
- 真实 Windows/macOS 两版本 update smoke test 仍待发布者执行，未伪造完成状态；artifact-only workflow 不等于正式 updater release。


### Git Commits

| Hash | Message |
|------|---------|
| `09692cd2f` | (see git log) |
| `dd3bf2e32` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: 收口 doge 更新版本记录

**Date**: 2026-08-26
**Task**: 收口 doge 更新版本记录
**Branch**: `codex/enable-doge-updater`

### Summary

恢复版本号到 0.1.0，删除一次性发布 workflow，保留 updater 60 秒检查超时并补充慢速网络回归测试；精简 CHANGELOG.md 为单条 doge v0.1.0 记录。验证通过 focused Vitest 25 tests、targeted ESLint、npm run typecheck、npm run check:branding、git diff --check。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c360482a7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: 合并远端更新并移除一次性 workflow

**Date**: 2026-08-26
**Task**: 合并远端更新并移除一次性 workflow
**Branch**: `codex/enable-doge-updater`

### Summary

安全合并 GitHub 同名分支，保留远端已有提交并删除 GitHub 创建的一次性 update_test.yml；解决 Trellis ngx 索引冲突时保留本地 session 4 记录。未使用强推。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `71db4b825` | (see git log) |
| `c360482a7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: 移除 macOS 系统签名校验

**Date**: 2026-08-26
**Task**: 移除 macOS 系统签名校验
**Branch**: `codex/enable-doge-updater`

### Summary

修改 .github/workflows/release.yml，移除 Apple certificate、Developer ID signing、notarization 和 stapler，改用 ad-hoc signing，同时保留 Tauri updater .app.tar.gz.sig 签名。新增 release workflow contract test；YAML、workflow contract 和 macOS focused contract 通过，完整 build-platform contract 有一个既有 marker 失败。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c8d47a420` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: 解决 PR 合并冲突

**Date**: 2026-08-26
**Task**: 解决 PR 合并冲突
**Branch**: `codex/enable-doge-updater`

### Summary

合并最新 origin/main 到 codex/enable-doge-updater，保留删除一次性 update_test workflow 的意图，完成 release.yml 三方结果核对。release workflow contract test 和 YAML parse 通过，准备推送更新 PR #31。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `3569a6039` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: 修复 macOS daemon 编译错误

**Date**: 2026-08-27
**Task**: 修复 macOS daemon 编译错误
**Branch**: `codex/enable-doge-updater`

### Summary

定位 GitHub Actions 的 E0432/E0433 根因：doge_daemon 的独立 engine_bridge 漏注册 kimi_launch 模块。补充 path module declaration 和 build-platform contract。cargo check --bin doge_daemon、release workflow contract 及相关 focused tests 通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a8cf0021a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: 修正 updater 验签公钥

**Date**: 2026-08-27
**Task**: 修正 updater 验签公钥
**Branch**: `codex/fix-updater-public-key`

### Summary

将 tauri updater 公钥从损坏的 KFuh7aw payload 修正为用户提供的 KFuh4aw payload，同步配置测试、release contract 与已归档 OpenSpec 事实源；删除上一轮误诊产生的重签 workflow、临时 verifier 与 active change。L3 验证通过：updater Vitest 2/2、release contract 7/7、typecheck、branding、diff check；L4 signed Release CI 与旧客户端到新安装包实机升级未在本地执行。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `644ba4b74` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: 修复新建会话及页面切换后的引擎路由与显示

**Date**: 2026-08-27
**Task**: 修复新建会话及页面切换后的引擎路由与显示
**Branch**: `fix/create-session-engine-routing`

### Summary

修复 prompt/intent canvas/kanban composer 新建会话时引擎透传、Composer target 未就绪拦截、/clear /new 继承 thread engine + providerProfileId、queue 消息冻结引擎、已有会话 Composer 以 engineSource 为准。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `3e1776daf1ac1d1e8d3d818726299703f45514ea` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: 修复账户侧边栏入口 React 更新深度循环

**Date**: 2026-08-27
**Task**: 修复账户侧边栏入口 React 更新深度循环
**Branch**: `fix/create-session-engine-routing`

### Summary

将 TooltipTrigger 与 PopoverTrigger 的 asChild ref 组合拆开，避免 Radix setRef 更新深度循环；补充 wrapper 尺寸样式。人工验证通过，AccountSidebarShortcut 与 accountVisualContract 共 17 项 focused tests 通过，changed-file ESLint 通过。代码已纳入 PR #36。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `bef37b6a9` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 12: OpenSpec 归档与 Kimi bundle PR

**Date**: 2026-08-28
**Task**: OpenSpec 归档与 Kimi bundle PR
**Branch**: `codex/archive-kimi-windows-shell-runtime`

### Summary

归档 32 个 OpenSpec changes，完成 main specs 与治理索引同步；按用户授权将 bundle-kimi-windows-shell-runtime 作为 waiver archive 收口，保留 11 个跨平台与 release 未完成任务，并准备 PR。
## Session 13: 修复工作区会话启动加载

**Date**: 2026-08-28
**Task**: 修复工作区会话启动加载
**Branch**: `codex/fix-workspace-session-startup-hydration`

### Summary

修复 startup gate-ready 后可见非 active workspace 会话列表不会自动 hydration、导致 Sidebar 一直 Loading 需点击才出现的问题。按 idle 顺序逐个执行 bounded first-paint hydration，复用 orchestrator dedupe/stale/concurrency；补充 sibling 顺序、排除 collapsed/disconnected、Home 行为回归测试。focused Vitest 49 tests、typecheck、target ESLint、app-shell runtime contract、git diff check 通过；真实 Tauri 双 workspace 冷启动仍保留 manual QA waiver。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `14930420f` | (see git log) |
| `9542e4e45` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 14: 修复重启后模型目标恢复

**Date**: 2026-08-30
**Task**: 修复重启后模型目标恢复
**Branch**: `codex/fix-managed-session-target-cold-start`

### Summary

修复 Native 与 Shared Session 冷启动时 managed execution target 被默认 GPT 覆盖的问题；补齐 durable target、Shared V2 读取权威、renderer hydration、daemon IPC 与 managed runtime restore，并完成 L3 验证及 Windows 真实重启 smoke。

### Main Changes

- 为 Native session 持久化并恢复 `modelCatalogEntryId`、runtime `model` 与 `reasoningEffort`，补齐 Desktop/daemon IPC。
- 固定 Shared cold-start 的读取权威为 Shared V2 durable target，并阻止 hydration pending 时写回 Product default GPT。
- 修复 renderer target hydration、active thread engine 恢复与 managed runtime activation，保留 legacy metadata/cache 兼容。
- 同步 OpenSpec、cross-layer executable contract 与 multi-CLI foundation ADR calibration。

### Git Commits

| Hash | Message |
|------|---------|
| `712792f47` | (see git log) |

### Testing

- [OK] L3 focused Vitest：12 files / 346 tests。
- [OK] TypeScript typecheck、targeted ESLint、runtime contracts 与 OpenSpec strict validation。
- [OK] Rust execution-target tests（15 tests）、Shared V2 authority regression、library/daemon cargo checks 与 changed-file rustfmt。
- [OK] Windows debug App 真实退出/重启 smoke；managed 豆包 target 保持，未回落 GPT。
- [INFO] L4 full suites、packaged multi-platform builds 与 installer smoke 留给 Release/CI。

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 15: 归档模型目标恢复 OpenSpec

**Date**: 2026-08-30
**Task**: 归档模型目标恢复 OpenSpec
**Branch**: `codex/fix-managed-session-target-cold-start`

### Summary

归档 fix-managed-session-target-cold-start，向 codex-provider-scoped-session-launch、engine-per-session-provider-binding 与 shared-execution-target 同步 3 条 requirement，并校准 OpenSpec active/archive/spec 索引。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7d71949cc` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 16: 解决 PR #53 主分支冲突

**Date**: 2026-08-30
**Task**: 解决 PR #53 主分支冲突
**Branch**: `codex/fix-managed-session-target-cold-start`

### Summary

语义合并 main，保留 managed session execution target 与 upstream provider/runtime、terminal/realtime 能力；校准 OpenSpec 索引为 active 31、archive 886、specs 517，并完成 L3 focused verification。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ead66f4a8` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 17: 修复 Kimi managed session catalog 重启恢复

**Date**: 2026-08-30
**Task**: 修复 Kimi managed session catalog 重启恢复
**Branch**: `codex/fix-kimi-managed-session-catalog`

### Summary

修复 Kimi managed provider home 在重启后未被 workspace session catalog 枚举的问题；统一 list/load/delete provider-aware root resolver，补充首轮 durable history seed，并完成 OpenSpec 归档与 L3 验证。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `cb0812385` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete

## Session 18: 修复 guardian 后台会话重新出现在侧边栏

**Date**: 2026-08-31
**Task**: 归档并提交 fix-codex-guardian-session-catalog-visibility
**Branch**: `fix/codex-guardian-session-catalog-visibility`

### Summary

诊断 v0.1.12 guardian 会话复发根因：PR #38 只覆盖运行时 `list_threads`；启动 full-catalog hydration 走 `list_workspace_sessions`，catalog projection 丢弃 `background_kind`。修复：background 分类 helpers 下沉到 `local_usage.rs`（lib 与 daemon 共享），catalog projection 映射前过滤，daemon local fallback 与 live 透传两分支均过滤。OpenSpec change 已归档，PR #59 已创建。

### Main Changes

- `src-tauri/src/local_usage.rs` 承接分类 helpers；`thread_listing.rs` 改为复用
- `session_management_catalog_projection.rs` 过滤 background 会话
- `doge_daemon` codex_local_threads / daemon_state 两分支过滤 + 降级
- 新增 3 个回归测试；归档 `openspec/changes/archive/2026-08-31-fix-codex-guardian-session-catalog-visibility/`

### Git Commits

| Hash | Message |
|------|---------|
| `5997fb563` | fix(codex): 过滤后台会话的 catalog 投影与 daemon list_threads |

### Testing

- [OK] 新增 3 个回归测试通过；PR #38 回归（20 parse + 10 merge）通过；daemon_state_tests 13 通过
- [OK] `cargo check --all-targets` / `npm run typecheck` / `npm run check:runtime-contracts` / `openspec validate --strict`

### Status

[OK] **Completed**

### Next Steps

- 人工 UI 验收：重启后 catalog hydration 不再出现 guardian 会话（tasks.md 4.3）
- 本机无 Python（WindowsApps stub），Trellis record 为手工补录，未运行 get_context.py
