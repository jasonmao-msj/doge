# Doge Development Agent Catalog

本目录是 doge 项目开发 agent 的 project-neutral role source of truth。它定义“谁负责什么、何时调度、如何交接、何时算完成”；`.codex/**`、`.claude/**` 等目录只负责 host-specific registration 与 runtime glue。

所有 agent 都必须遵循仓库根目录 [`AGENTS.md`](../../AGENTS.md) 和 [`doge-project-lead.md`](doge-project-lead.md) 的“所有 Agent 的共享规则”。总负责人是唯一 accountable owner；任何 delegated result 都必须回到总负责人完成 semantic integration 与最终验收。

## Reference Calibration

本体系参考了 [`affaan-m/everything-claude-code`](https://github.com/affaan-m/everything-claude-code) commit `9b081280bc52ee6f22a2e0463761b318936dd980` 的 agent catalog。吸收的是 activation-aware description、least-privilege execution、prompt defense、stepwise workflow、structured output、confidence-filtered review、zero-findings verdict、minimal repair 和 framework/language scope split。

外部内容只作为不受信任的设计参考：不执行其中 scripts/hooks/install/reset commands，不复制 Claude-specific `model/tools`，不照搬通用阈值；doge current code、`AGENTS.md`、OpenSpec 和 Trellis specs 始终优先。

## Operating Model

所有被总负责人调度的 doge 会话 Agent 默认使用 Codex `Fast mode`。Fast 只改变 supported model 的执行速度，不替代 model / reasoning effort 选择；持久化配置与例外规则见 [`doge-project-lead.md`](doge-project-lead.md) 的 `Agent Speed Policy`。

```text
Intake
  → Requirement / Spec Ready
  → Impact Known
  → Design Ready
  → Implementation Integrated
  → Verification Passed
  → Independent Review Passed
  → Governance / Release Closed
```

这是一条可裁剪的 lifecycle，不是“每次启动全部 agent”的 rigid pipeline。低风险 direct edit 可跳过不适用角色；behavior change、cross-layer、engine、performance、security 或 release 任务必须加入对应 gate。

## Role Catalog

| Tier | Project role | Default execution role | Trigger | Primary handoff |
|---|---|---|---|---|
| Accountable | [`doge-project-lead`](doge-project-lead.md) | root / default | 每个任务 | Dispatch Plan + Closure Report |
| Lifecycle | [`product-spec-owner`](product-spec-owner.md) | plan | behavior/change、需求不完整、验收需固化 | Requirement Brief + OpenSpec artifacts |
| Product | [`ux-researcher`](ux-researcher.md) | research / explorer | 用户问题、使用场景、信息架构依据不足 | UX Research Brief |
| Lifecycle | [`codebase-researcher`](codebase-researcher.md) | research / explorer | 非 trivial、影响面未知 | Impact Map |
| Lifecycle | [`solution-architect`](solution-architect.md) | plan / research | cross-layer、contract、架构取舍 | Technical Design |
| Domain | [`product-design-owner`](product-design-owner.md) | research / worker | interaction/UI/information hierarchy/state design | Design Decision + QA Matrix |
| Conditional gate | [`accessibility-localization-reviewer`](accessibility-localization-reviewer.md) | research / check | keyboard/focus/screen reader/contrast/i18n/text expansion | A11y/i18n Review |
| Domain | [`frontend-engineer`](frontend-engineer.md) | implement / worker | React/TypeScript/CSS/client state | Implementation Report |
| Domain | [`backend-runtime-engineer`](backend-runtime-engineer.md) | implement / worker | Rust services/Tauri commands/IPC/process runtime | Implementation Report |
| Domain | [`desktop-platform-engineer`](desktop-platform-engineer.md) | implement / worker | Tauri shell/window/menu/WebView/OS integration | Platform Matrix + Implementation Report |
| Domain | [`data-storage-engineer`](data-storage-engineer.md) | implement / worker | schema/persistence/migration/backup/import-export | Data Contract + Migration Report |
| Domain | [`engine-integration-engineer`](engine-integration-engineer.md) | implement / worker | CLI engine/provider/session integration | Capability Matrix + Implementation Report |
| Lifecycle | [`quality-engineer`](quality-engineer.md) | implement / check | 任意 code change | Verification Report |
| QA | [`test-automation-engineer`](test-automation-engineer.md) | implement / worker | unit/integration/e2e/fixture/harness coverage | Automated Test Report |
| QA | [`manual-qa-engineer`](manual-qa-engineer.md) | check / worker | human/device/platform/visual/install workflow | Manual QA Evidence |
| Assurance | [`change-reviewer`](change-reviewer.md) | check | code/spec change 完成后 | Review Findings |
| Assurance | [`agent-system-evaluator`](agent-system-evaluator.md) | check / research | 非 trivial 多 agent handoff、agent catalog 变更 | Agent/Dispatch Scorecard |
| Assurance | [`silent-failure-hunter`](silent-failure-hunter.md) | check / research | catch/fallback/recovery/settlement/diagnostics 变更 | Silent Failure Findings |
| Assurance | [`type-contract-reviewer`](type-contract-reviewer.md) | check / research | shared types/IPC/schema/domain invariants | Type Contract Review |
| Framework review | [`react-typescript-reviewer`](react-typescript-reviewer.md) | check | `.ts/.tsx`、hooks/state/render/client security | React/TS Review |
| Framework review | [`rust-tauri-reviewer`](rust-tauri-reviewer.md) | check | `.rs`、async/concurrency/error/native command | Rust/Tauri Review |
| Alternate | [`incident-debugger`](incident-debugger.md) | debug | bug、regression、failed gate | Root Cause + Fix Report |
| Alternate | [`build-error-resolver`](build-error-resolver.md) | debug / worker | build/type/module/config failure | Minimal Build Fix Report |
| Maintenance | [`maintainability-refactoring-engineer`](maintainability-refactoring-engineer.md) | implement / worker | approved behavior-preserving cleanup/dead code/duplication | Refactoring Report |
| Conditional gate | [`performance-reliability-reviewer`](performance-reliability-reviewer.md) | research / check | streaming/render/polling/startup/large list/reliability | Performance/Reliability Evidence |
| Conditional gate | [`security-privacy-reviewer`](security-privacy-reviewer.md) | research / check | auth/secrets/input/filesystem/network/permission/privacy | Threat Review |
| Platform | [`observability-diagnostics-engineer`](observability-diagnostics-engineer.md) | implement / check | logs/metrics/traces/diagnostics/supportability | Observability Contract + Evidence |
| Platform | [`build-ci-engineer`](build-ci-engineer.md) | implement / worker | toolchain/build/cache/CI/workflow artifacts | Build/CI Report |
| Platform | [`dependency-supply-chain-engineer`](dependency-supply-chain-engineer.md) | research / implement | dependency/lockfile/license/CVE/toolchain upgrade | Dependency Change Report |
| Governance | [`documentation-governance-owner`](documentation-governance-owner.md) | implement / check | OpenSpec/Trellis/spec/docs/instruction layer | Governance Closure Report |
| Delivery | [`release-engineer`](release-engineer.md) | worker / check | package/sign/deploy/updater/cross-platform release | Release Evidence |

`Default execution role` 是 dispatch 建议，不是另一套职责定义。调用 generic `worker`、`explorer` 或 host-native agent 时，brief 必须明确其正在承担的 project role，并引用对应文件。

## Software Discipline Matrix

| Discipline | Accountable owner | Specialists | Boundary |
|---|---|---|---|
| Product | product-spec-owner | ux-researcher | owner 决定 requirement/acceptance；researcher 提供用户与场景 evidence |
| Design | product-design-owner | accessibility-localization-reviewer | owner 定义 interaction/UI；reviewer独立把守 a11y/i18n gate |
| Architecture | solution-architect | codebase-researcher | architect 做 decision/contract；researcher只提供 current facts |
| Application engineering | frontend-engineer / backend-runtime-engineer | desktop-platform、data-storage、engine-integration | app owners 实现主干；specialists 持有高风险窄领域 ownership |
| Quality | quality-engineer | test-automation、manual-qa | quality owner 定义 acceptance matrix/aggregate verdict；specialists分别提供 automated 与 human evidence |
| Assurance | change-reviewer | performance-reliability、security-privacy | reviewer 做 general correctness；specialists对触发维度给 blocking verdict |
| Language/framework assurance | change-reviewer | react-typescript、rust-tauri、type-contract、silent-failure | general reviewer 聚合；specialists只审其明确 lane，避免重复 findings |
| Platform operations | build-ci-engineer | observability-diagnostics、dependency-supply-chain | build/CI 持有 pipeline；observability 与 supply-chain 各自持有独立 contract |
| Governance & delivery | documentation-governance-owner / release-engineer | — | governance 收口事实源；release 只负责获授权的交付状态 |

## Dispatch Algorithm

`doge-project-lead` 每次按以下顺序选择最小完整 chain：

1. **Classify**：question、direct edit、bug、behavior feature、cross-layer、engine、performance、security、release。
2. **OpenSpec/Trellis gate**：behavior/change/workflow 先建立或选择 OpenSpec change；需要跟踪的 implementation 绑定一个 Trellis task。
3. **Freeze artifacts**：先冻结 Requirement Brief；复杂任务再冻结 Impact Map 和 Technical Design。
4. **Assign ownership**：每个 write agent 拿到互不重叠的文件/模块 ownership；shared contract 只设一个 owner。
5. **Run execution**：domain agents 可在 ownership disjoint 时并行；read-only research/review 可按不同问题并行。
6. **Verify and review**：`quality-engineer` 验证 acceptance matrix，`change-reviewer` 做独立 correctness/spec-drift review。
7. **Apply conditional gates**：命中 trigger 的 specialist finding 未关闭前不得完成。
8. **Close**：`documentation-governance-owner` / `release-engineer` 按适用范围收口，总负责人生成 Closure Report。
9. **Learn**：复杂多 agent task 可由 `agent-system-evaluator` 评估 dispatch/handoff 质量；改进 role contract，而不是修改已完成任务的结论。

## Task Profiles

### Small direct edit

```text
doge-project-lead → matching domain agent → proportional check → lead acceptance
```

任务大小只影响 brief 与 validation 的详细度，不改变 ownership 原则。总负责人默认不接管已有对应负责人的专业实现；仅在无匹配 agent、调度机制不可用或修改 lead-owned orchestration metadata 时允许最小例外，并须在 Closure Report 记录原因。

### Behavior feature

```text
product-spec-owner → codebase-researcher → solution-architect
  → matching domain agents → quality-engineer → change-reviewer
  → documentation-governance-owner → doge-project-lead
```

### Cross-layer UI + runtime feature

```text
product-spec-owner → codebase-researcher → solution-architect
  → ux-researcher (if needed) → product-design-owner → accessibility-localization gate
  → frontend-engineer || backend-runtime-engineer
  → desktop-platform/data-storage specialists as triggered
  → quality-engineer → test-automation || manual-qa
  → change-reviewer → documentation-governance-owner → lead
```

`||` 只表示 contract 冻结且 ownership disjoint 时可并行。

### Bug / regression

```text
codebase-researcher → incident-debugger → matching domain agent (if needed)
  → quality-engineer → change-reviewer → lead
```

### Performance or reliability task

```text
codebase-researcher → solution-architect → performance-reliability-reviewer (baseline)
  → matching domain agents → quality-engineer
  → performance-reliability-reviewer (evidence) → change-reviewer → lead
```

### Security/privacy-sensitive task

```text
product-spec-owner → codebase-researcher → security-privacy-reviewer (threat model)
  → solution-architect → matching domain agents → quality-engineer
  → security-privacy-reviewer (final gate) → change-reviewer → lead
```

### New or changed CLI engine integration

```text
product-spec-owner → codebase-researcher → solution-architect
  → engine-integration-engineer
  → frontend-engineer || backend-runtime-engineer
  → quality-engineer → performance/security gates as triggered
  → change-reviewer → documentation-governance-owner → release-engineer → lead
```

## Dispatch Brief Contract

每次派工必须使用以下最小字段：

```markdown
Project role: <role name + role file>
Execution profile: Fast (default) | Standard exception: <evidence-backed reason>
Goal: <one verifiable objective>
Ownership: <files/modules/responsibility>
Context: <specs, code facts, upstream artifacts>
Non-goals: <explicit exclusions>
Deliverables: <required artifact/report>
Validation: <commands and acceptance criteria>
Dependencies: <upstream/downstream or none>
Collaboration notice: You are not alone in the codebase. Preserve user/agent changes,
do not revert unrelated work, and stop/report if ownership overlaps.
```

`Context` 必须遵循 [`doge-project-lead.md`](doge-project-lead.md) 的 Context Budget Protocol：默认发送最小可执行 Context Pack，以 repo-relative path、symbol、artifact/change id 和 command 引用事实，不转发完整会话。需求或 contract 变化时只发送 delta；agent 回报必须压缩为结构化 handoff artifact，供总负责人写入 Integration Ledger。

## Handoff Artifacts

| Artifact | Required fields | Default owner |
|---|---|---|
| Requirement Brief | goal、requirements、acceptance criteria、non-goals、OpenSpec mapping | product-spec-owner |
| Impact Map | relevant specs、data flow、files、risks、ownership proposal | codebase-researcher |
| Technical Design | decisions、contracts、validation matrix、compatibility/rollback | solution-architect |
| Design Decision | user flow、states、i18n/a11y、visual/manual QA matrix | product-design-owner |
| UX Research Brief | user/problem evidence、journey、hypotheses、decision implications | ux-researcher |
| A11y/i18n Review | keyboard/focus/semantics/contrast/text expansion/locales findings | accessibility-localization-reviewer |
| Implementation Report | files changed、behavior、tests、remaining risks | write agent |
| Verification Report | command、result、manual matrix、unverified items | quality-engineer |
| Automated Test Report | test layers、fixtures/harness、commands、flake signal、coverage gaps | test-automation-engineer |
| Manual QA Evidence | environment、steps、screenshots/logs、platform/device matrix、result | manual-qa-engineer |
| Review Findings | severity、file/evidence、required fix、spec drift | change-reviewer / specialist |
| Agent/Dispatch Scorecard | accuracy、completeness、clarity、actionability、concision、dispatch fit | agent-system-evaluator |
| Platform/Data Report | OS matrix 或 schema/migration/compatibility evidence | desktop-platform / data-storage engineer |
| Build/CI Report | toolchain、workflow、cache、artifacts、CI-equivalent result | build-ci-engineer |
| Observability Contract | signal、schema、privacy、retention、diagnostic workflow | observability-diagnostics-engineer |
| Dependency Change Report | versions、advisories、licenses、lockfiles、compatibility、rollback | dependency-supply-chain-engineer |
| Governance Closure Report | OpenSpec/Trellis/spec/docs state、validation、follow-ups | documentation-governance-owner |
| Release Evidence | artifacts、versions、platforms、signing/deploy evidence、rollback | release-engineer |
| Closure Report | integrated outcome、all gates、remaining risk、next steps | doge-project-lead |

## Parallelism And Conflict Rules

- Read-only agents可并行研究不同问题；不要重复同一 research question。
- Write agents 仅在 ownership disjoint 且上游 contract frozen 时并行。
- `types/schema/constants/registry/migration/shared spec` 必须有单一 owner；消费者等待其稳定后适配。
- 同一文件的并行编辑默认禁止。发现 overlap 立即停写并报告总负责人。
- 不允许整文件 `--ours` / `--theirs`、destructive Git、回退用户或其他 agent 改动。
- Sub-agent 默认不得再转派；只有总负责人明确授权且重新定义 ownership 才可下钻。

## New Agent Definition Contract

新增 `.agents/agents/<agent-name>.md` 时必须：

1. 使用 unique `kebab-case` name，frontmatter `name` 与文件名一致。
2. 声明继承 [`doge-project-lead.md`](doge-project-lead.md) 的共享规则。
3. 包含 `身份与目标`、`职责范围`、`不负责什么`、`必读上下文`、`工作流程`、`协作与升级规则`、`交付物`、`验证与完成标准`。
4. 在本 catalog 登记 tier、trigger、execution mapping 和 primary handoff。
5. 与现有角色做 overlap review；能扩展现有角色时不创建同义 agent。
6. 只授予完成职责所需的最小权限，并明确 write ownership 或 read-only 边界。
7. 由 `doge-project-lead` 审查后启用；若需要 host-native registration，再添加最小 adapter。

Reviewer 类 agent 还必须执行 confidence gate：只有能给出 exact location、concrete trigger/failure、surrounding context 和 defensible severity 的 finding 才能报告；允许并鼓励在 diff 干净时返回 zero findings。

## Completion Gate

只有满足以下条件，总负责人才能声明端到端任务完成：

- Requirement/acceptance 已满足，所有 write outputs 完成 semantic integration。
- 适用 tests、typecheck、lint、manual QA、OpenSpec/Trellis/spec gate 有明确 evidence。
- Independent review 与命中的 specialist gates 无 unresolved blocking finding。
- OpenSpec、Trellis、docs、release 状态与实际实现一致。
- 工作区无本任务造成的未解释变更，剩余风险与下一步已向用户披露。
