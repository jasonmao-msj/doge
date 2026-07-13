# 修复 AppShell composer 冷启动收敛

## Goal

修复生产包冷启动期间 settings readiness、pending thread finalize 与 composer selection hydration 并发时的 React #185，确保 selection 恢复有限、连续且幂等。

## OpenSpec

- Change: `fix-app-shell-composer-startup-convergence`
- Source of truth: `openspec/changes/fix-app-shell-composer-startup-convergence/`

## Requirements

- reload effect 不得由自身 cache state write 重新触发。
- pending selection 必须在 canonical thread 发布前完成迁移。
- StrictMode 与等价 selection 重放不得重复落盘。
- React Scan 不得直接修改非公开 instrumentation signal。
- 不启动任何 desktop App，由用户负责最终实机验收。

## Acceptance Criteria

- [x] 组合回归测试覆盖 readiness + pending-to-canonical + persisted selection。
- [x] canonical active selection 不 transiently clear。
- [x] focused tests、lint、typecheck、build 通过。
- [x] OpenSpec strict validation 通过并记录 verification evidence。

## Technical Notes

采用同步 cache ref + equality-gated state notification，保留现有 storage schema 与 resolver contract；不引入新依赖。
