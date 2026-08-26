# Tasks

## 1. OpenSpec and configuration

- [x] 1.1 [P0][I:proposal/design/spec][O:change-local updater behavior contract][V:strict OpenSpec validation] 建立 OpenSpec change。
- [x] 1.2 [P0][I:brand + Tauri config][O:canonical endpoint/public key/active artifacts][V:branding and config tests] 启用 doge shipping trust chain。

## 2. Release pipeline

- [x] 2.1 [P0][I:release workflow][O:Windows/macOS signed artifacts referenced by latest.json][V:release contract test and preflight inspection] 对齐 release pipeline。
- [x] 2.2 [P1][I:Windows CRLF checkout][O:portable workflow contract parser][V:node test on Windows checkout] 修复 workflow contract test 的换行假失败。

## 3. Runtime updater safety

- [x] 3.1 [P0][I:useUpdater][O:single active operation with stale continuation suppression][V:focused Vitest] 收口 dismiss/repeated action/download race。
- [x] 3.2 [P1][I:UpdateToast][O:busy state cannot dismiss active install][V:component test] 锁定用户反馈与操作边界。

## 4. Verification and handoff

- [x] 4.1 [P0][I:affected frontend/release surfaces][O:L3 verification evidence][V:Vitest, ESLint, typecheck, branding, contract checks] 执行 focused gates。
- [x] 4.2 [P0][I:OpenSpec artifacts][O:strictly validated change][V:openspec validate --strict --no-interactive] 完成 spec validation。
- [ ] 4.3 [P1][I:real Windows/macOS packages][O:two-release update smoke evidence][V:manual platform matrix] 由发布者使用 GitHub secrets 完成真实安装包验收。
