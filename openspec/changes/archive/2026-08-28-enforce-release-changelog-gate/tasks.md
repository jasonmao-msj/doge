## 1. Release Notes Contract

- [x] 1.1 [P0][Depends: none][Input: six manifests + CHANGELOG][Output: pure parser/version validator/current extractor][Verify: Node unit tests cover good/base/bad matrices] 实现 release changelog library/CLI。
- [x] 1.2 [P0][Depends: 1.1][Input: v0.1.0-v0.1.3 tag/release facts][Output: ordered bilingual CHANGELOG history][Verify: CLI check + frontend parser test] 回填历史。

## 2. Governance And Workflow

- [x] 2.1 [P0][Depends: 1.1][Input: approved release process][Output: AGENTS gate + Trellis release guide/code-spec + package scripts][Verify: docs check] 固化 AI release preparation rule。
- [x] 2.2 [P0][Depends: 1.1][Input: ci.yml/release.yml][Output: CI/preflight gate + committed notes extraction; no post-release mutation][Verify: release workflow contract test] 改造 workflow。

## 3. Verification And Delivery

- [x] 3.1 [P0][Depends: 1.2,2.2][Input: affected scripts/docs/workflows/frontend parser][Output: L3 verification evidence][Verify: Node/Vitest, branding, docs, typecheck, OpenSpec strict, git diff check] 完成自动验证。
- [x] 3.2 [P0][Depends: 3.1][Input: clean branch][Output: code commit + Trellis record + dedicated PR][Verify: PR CLEAN/MERGEABLE] 提交并开 PR。

## 4. First Signed Release Exercise

- [x] 4.1 [P0][Depends: 3.2][Input: legacy origin tags][Output: exact target-tag collision preflight][Verify: workflow contract + remote fact check] 阻断错误 tag 复用。
- [x] 4.2 [P0][Depends: 4.1][Input: v0.1.3..main][Output: v0.1.10 versions + bilingual CHANGELOG][Verify: release:check + branding + Cargo metadata] 准备 release PR。
- [x] 4.3 [P0][Depends: 4.2][Input: cross-runner unrelated 5s timeouts][Output: bounded batched CI retry contract][Verify: parser/args/workflow tests + green test-js/test-windows] 稳定 batched CI gate。
- [x] 4.4 [P0][Depends: 4.3][Input: repeated Unix descendant ESRCH race][Output: bounded reaping assertion][Verify: repeated focused Rust test + green test-tauri] 稳定 probe cleanup regression。
- [x] 4.5 [P0][Depends: 4.4][Input: merged green main][Output: signed v0.1.10 Release][Verify: workflow + tag/assets/latest.json] 发布并核验。
