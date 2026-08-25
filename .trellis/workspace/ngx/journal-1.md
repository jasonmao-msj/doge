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
