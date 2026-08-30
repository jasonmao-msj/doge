# 精选同步上游稳定性修复

## Goal

按 OpenSpec `sync-upstream-stability-2026-08` 的 capability matrix，从 `upstream/main@cd362f8cf` 语义移植对 doge 有价值的 correctness、provider facts 与 cross-platform 修复，保留 doge 账号、Product target catalog、lazy provisioning、terminal authority 与 release trust chain。

## Requirements

- 严格执行 `upstream-capability-matrix.md` 的 adopt/adapt/reject/defer 结论。
- 冲突按 symbol/capability semantic merge，禁止整文件 ours/theirs。
- terminal fix 不得放宽 exact-turn lifecycle authority。
- provider/model 修复不得创建第二个 Product catalog owner。
- native/Windows 修复必须 failure-safe，不得成为启动 gate。
- network canonicalize blanket fallback 不在本 task 实施。
- L3 focused verification；Windows/macOS/Linux runtime smoke 留给 L4 CI/Release。

## Acceptance Criteria

- [ ] OpenSpec tasks 2–7 完成并 strict-valid。
- [ ] adopted behavior 有 focused regression tests。
- [ ] deferred/rejected upstream surfaces 未进入 shipping code。
- [ ] `npm run typecheck`、runtime contracts、focused Vitest/Rust/cargo checks 通过。
- [ ] foundation ADR 按更新触发器回写。
- [ ] 代码提交、Trellis session record、push 与 PR 完成。

## Technical Notes

- OpenSpec change: `openspec/changes/sync-upstream-stability-2026-08/`
- Verification level: L3；理由是 frontend event lifecycle + Rust runtime/provider + native platform + Git/file-link 跨层变更。
- L4 gaps: Windows WebView2 native hook runtime、Windows mapped drive、跨平台 installer/build 与真实长会话 smoke。
