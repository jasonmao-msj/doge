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
