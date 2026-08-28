# 强制 AI 管理 Release CHANGELOG

## Goal

将 committed `CHANGELOG.md` 建立为 App offline Version History 与 GitHub Release body 的唯一内容源；AI
发布准备自动整理双语增量 notes，CI/Release workflow 强制校验，普通开发者无感。

OpenSpec change：`enforce-release-changelog-gate`。

## Requirements

- AI release preparation PR 同时更新六处 version 与 CHANGELOG current entry。
- App 不请求 GitHub API，继续 lazy import bundled CHANGELOG。
- release check 必须验证 version parity、current-first、date、bilingual、unique descending history。
- 普通 CI 与 signed release preflight 复用同一 gate。
- workflow 从 committed current entry生成 `release-notes.md`，供 latest.json/GitHub Release 共用。
- 删除 global tag sort commit generator 与 post-release bump/PR。
- 回填 v0.1.1-v0.1.3。

## Acceptance Criteria

- [x] `npm run release:check` 在当前 main pass，负例 fixtures fail。
- [x] frontend parser 读取 0.1.3/0.1.2/0.1.1/0.1.0。
- [x] CI 与 release preflight都有 changelog gate。
- [x] release workflow不再扫描 commits或创建 PR。
- [x] extracted current notes中英完整且与 CHANGELOG exact。
- [x] L3 focused verification通过并创建独立 PR。

## Definition of Done

- OpenSpec/Trellis/code-spec 深度满足 signature/contract/matrix/cases/tests。
- Node/Vitest/contract/docs/branding/typecheck通过。
- 不触发 Release、不修改 repo security settings。

## Technical Approach

Pure Node parser/validator/extractor + AI governance rule + dual CI/release enforcement。脚本不生成产品文案；AI
curate，gate validate，workflow extract。

## Decision (ADR-lite)

**Context**：workflow临时生成无法进入 tag source；GitHub API带来运行时依赖；单纯规则不可强制。

**Decision**：AI committed changelog与executable gate组合，workflow只读发布。

**Consequences**：Release preparation PR成为唯一合法发布前置；普通开发无新增工作，AI需按规则整理双语文案。

## Out of Scope

- Tag ruleset/GitHub App。
- App UI redesign或remote Releases fetch。
- 新版本/tag/Release发布。

## Verification Level

L3：改变 CI/Release发现、fail-closed与artifact metadata source。执行 Node script tests、workflow contract、
frontend parser、branding/docs/typecheck/OpenSpec；L4真实平台build由后续Release承担。
