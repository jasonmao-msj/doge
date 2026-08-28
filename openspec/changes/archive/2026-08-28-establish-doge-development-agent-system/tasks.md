## 1. Catalog Foundation

- [x] 1.1 `[P0][依赖: proposal/design]` 输入角色研究与 lifecycle 决策，输出 `.agents/agents/README.md` 的 role tiers、runtime mapping、dispatch matrix、handoff artifacts 与 task profiles；验证所有常见任务类型都有 chain 且无默认全量 agent。
- [x] 1.2 `[P0][依赖: 1.1]` 输入 agent creation contract，输出可复用的 role definition schema 与 future-agent checklist；验证 name/file/scope/non-goals/context/workflow/handoff/validation/escalation 字段齐全。

## 2. Accountable And Lifecycle Roles

- [x] 2.1 `[P0][依赖: 1.1]` 输入 catalog，校准 `doge-project-lead.md` 的 roster、dispatch algorithm 与 closure responsibility；验证 lead 是唯一 accountable owner。
- [x] 2.2 `[P0][依赖: 1.1]` 创建 `product-spec-owner`、`codebase-researcher`、`solution-architect`；验证 requirement brief → impact map → technical design handoff 可闭合。
- [x] 2.3 `[P0][依赖: 1.1]` 创建 `quality-engineer`、`change-reviewer`、`incident-debugger`；验证 test/verification、independent review 与 regression debug 责任互不替代。

## 3. Domain And Specialist Roles

- [x] 3.1 `[P1][依赖: 1.1]` 创建 `product-design-owner` 与 `frontend-engineer`；验证 UI/UX/i18n/a11y 决策与 React implementation ownership 分离。
- [x] 3.2 `[P0][依赖: 1.1]` 创建 `backend-runtime-engineer` 与 `engine-integration-engineer`；验证 Tauri/backend ownership 与 Engine Onboarding Gate 专项 ownership 分离。
- [x] 3.3 `[P1][依赖: 1.1]` 创建 `performance-reliability-reviewer` 与 `security-privacy-reviewer`；验证 trigger 命中时为 blocking gate，未命中时可标记 not applicable。
- [x] 3.4 `[P1][依赖: 1.1]` 创建 `documentation-governance-owner` 与 `release-engineer`；验证 OpenSpec/Trellis/docs closure 与 packaging/deployment/release evidence 分离。

## 4. Instruction Layer Integration

- [x] 4.0 `[P1][依赖: 1.1]` 创建 `ux-researcher`、`accessibility-localization-reviewer`、`desktop-platform-engineer`、`data-storage-engineer`、`test-automation-engineer`、`manual-qa-engineer`、`build-ci-engineer`、`observability-diagnostics-engineer`、`dependency-supply-chain-engineer`；验证每个工种有独立 trigger、ownership boundary 与 handoff。
- [x] 4.1 `[P1][依赖: 1.1]` 参考 Everything Claude Code 固定 commit 创建/校准 `build-error-resolver`、`silent-failure-hunter`、`type-contract-reviewer`、`react-typescript-reviewer`、`rust-tauri-reviewer`、`maintainability-refactoring-engineer`、`agent-system-evaluator`；验证 doge-specific scope、confidence gate、minimal-diff 与 untrusted-content boundary。

- [x] 4.2 `[P0][依赖: 1.1,2.1]` 更新 `AGENTS.md` 最小导航和 `.trellis/spec/guides/project-instruction-layering-guide.md` ownership matrix；验证 `.agents/**` 是 project-neutral source，host configs 只保留 adapter/registration。
- [x] 4.3 `[P1][依赖: OpenSpec artifacts]` 更新 `openspec/changes/README.md` active index；验证 change、progress、gate 和 artifact links 可达。

## 5. Verification And Closure

- [x] 5.1 `[P0][依赖: 2.*,3.*,4.*]` 运行 frontmatter/name、required-section、local-link、role coverage 与 duplicate ownership checks；输出可复现验证结果并修复失败项。
- [x] 5.2 `[P0][依赖: 5.1]` 运行 `openspec validate establish-doge-development-agent-system --strict --no-interactive` 与 `git diff --check`；输出 PASS/FAIL evidence。
- [x] 5.3 `[P1][依赖: 5.2]` 对照 PRD acceptance criteria 与实际 diff 做 final semantic review，更新 tasks checkbox 与 Trellis context；验证无无关修改、无 false completion、未执行 commit/archive。
