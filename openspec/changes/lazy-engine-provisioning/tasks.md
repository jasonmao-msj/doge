# Tasks

## 1. Contract and planning

- [x] 1.1 建立 Trellis PRD、OpenSpec proposal/design/spec delta 与 L3 validation matrix。
- [x] 1.2 更新 parent Product subscription spec 中 eager startup preparation 的 superseded wording。
- [x] 1.3 初始化 Trellis fullstack context 并记录 Engine Onboarding §0 affected matrix。

## 2. Startup decoupling

- [x] 2.1 Product gate 删除 three-engine eager toolchain provisioning 与 engine-specific full-screen preparing UI。
- [x] 2.2 active catalog 后立即 publish shell-ready snapshot + mount AppShell；account/model bootstrap 后台收敛且失败 non-blocking。
- [x] 2.3 `account_product_v1_prepare(engineId?)` 拆分 catalog-only 与 exact-engine config semantics，补 Rust/bridge tests。

## 3. Send-time provisioning

- [x] 3.1 新增 per-engine provisioning coordinator/store：frozen target、dedupe、generation、retry、safe state。
- [x] 3.2 复用 product account prepare、managed toolchain、existing CLI installer event 与 activation；Kimi 保持 one-shot。
- [x] 3.3 New Home/Native、Existing Native、Shared send 在 side effect 前复用 coordinator；失败恢复 draft/attachments。
- [x] 3.4 toolchain resolver 支持 shipping bundle ready 与 verified external fallback；unknown/invalid fail closed。

## 4. Non-blocking progress UI

- [x] 4.1 UpdateToast 改为 shared stack card；新增 EngineProvisioningToast 复用 `.update-toast*` classes。
- [x] 4.2 installed/bundled/external silent；actual installing/ready/error/retry/dismiss 行为与 safe i18n copy。
- [x] 4.3 updater + engine card stacking component contract、light/dark token reuse 与 macOS Hot Doge 目视通过；Windows packaged visual 留给 L4 Release/CI。

## 5. Verification and documentation

- [x] 5.1 Rust account/toolchain focused tests、React gate/coordinator/send/toast tests、service mapping tests。
- [x] 5.2 targeted ESLint、typecheck、`cargo check --lib`、runtime/engine/docs/OpenSpec gates。
- [x] 5.3 更新 `.trellis/spec/**` executable contract 与 foundation ADR 最近校准/当前实现表。
- [x] 5.4 Hot Doge 清空 app-data/login state 并卸载 global Kimi 后冷启动；用户目视确认登录/首页/engine switching 行为通过，failure/retry 由 focused regression 覆盖。
- [ ] 5.5 commit、Trellis record、push PR；PR 描述附 §0 matrix、视觉验收与 CI gate。
