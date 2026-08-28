## 1. Release Notes Contract

- [x] 1.1 [P0][Depends: none][Input: six manifests + CHANGELOG][Output: pure parser/version validator/current extractor][Verify: Node unit tests cover good/base/bad matrices] 实现 release changelog library/CLI。
- [x] 1.2 [P0][Depends: 1.1][Input: v0.1.0-v0.1.3 tag/release facts][Output: ordered bilingual CHANGELOG history][Verify: CLI check + frontend parser test] 回填历史。

## 2. Governance And Workflow

- [x] 2.1 [P0][Depends: 1.1][Input: approved release process][Output: AGENTS gate + Trellis release guide/code-spec + package scripts][Verify: docs check] 固化 AI release preparation rule。
- [x] 2.2 [P0][Depends: 1.1][Input: ci.yml/release.yml][Output: CI/preflight gate + committed notes extraction; no post-release mutation][Verify: release workflow contract test] 改造 workflow。

## 3. Verification And Delivery

- [x] 3.1 [P0][Depends: 1.2,2.2][Input: affected scripts/docs/workflows/frontend parser][Output: L3 verification evidence][Verify: Node/Vitest, branding, docs, typecheck, OpenSpec strict, git diff check] 完成自动验证。
- [x] 3.2 [P0][Depends: 3.1][Input: clean branch][Output: code commit + Trellis record + dedicated PR][Verify: PR CLEAN/MERGEABLE] 提交并开 PR。
