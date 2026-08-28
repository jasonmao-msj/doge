## Context

doge 当前已经具备三类互补但未统一的 agent 基础：

- `.codex/agents/*.toml` 提供 host-native `plan/research/implement/check/debug/dispatch` execution roles。
- Trellis + OpenSpec 提供 requirement、task、implementation、verification 和 closure lifecycle。
- `AGENTS.md` 与 `.trellis/spec/**` 提供项目 gate，但没有 project-neutral role catalog 指明“谁在什么条件下负责什么”。

用户希望由一个总负责人长期调度多个专业 agent 完成端到端任务。主要约束是：共享工作区不允许重叠写入、host adapter 不应成为 project role 的第二事实源、专项 gate 不能每次全量运行、总负责人不能因 delegation 丢失最终责任。

## Goals / Non-Goals

**Goals:**

- 建立从 intake 到 release closure 的 agent lifecycle。
- 定义唯一 accountable owner、role tiers、dispatch triggers、handoff artifacts 和 completion gates。
- 让 domain implementation 可安全并行，让 read-only specialist review 可按风险并行。
- 让 project-neutral role definitions 可映射到现有 host execution roles，而不新增 runtime dependency。
- 让未来新增 agent 有可验证的 schema 和 review gate。

**Non-Goals:**

- 不修改产品内 Multi-Engine Collaboration 的 control plane 或 UI。
- 不把每个 project role 注册为新的 Codex/Claude native type。
- 不建立 autonomous agent society；所有 work 都由 `doge-project-lead` 派发和验收。
- 不替代 OpenSpec、Trellis、现有 skills 或 CI gate。

## Decisions

### Decision 1: 使用 lifecycle + domain hybrid，而不是单一角色维度

角色分三类：

| Tier | Roles | 语义 |
|---|---|---|
| Accountable control | `doge-project-lead` | 唯一最终负责人；定义 chain、ownership、依赖和 acceptance |
| Lifecycle/domain execution | spec、research、architecture、design、frontend、backend/runtime、engine、quality、review、debug、docs、release | 按任务类型进入主链并产出明确 handoff |
| Specialist workforce | UX research、a11y/i18n、desktop platform、data/storage、test automation、manual QA、build/CI、observability、dependency supply-chain | 按真实软件工种承接窄 ownership |
| Conditional specialist gates | performance/reliability、security/privacy | 仅 trigger 命中时成为 blocking gate |

Alternative 是只保留 generic lifecycle agents，维护更简单，但不足以承载 doge 的 Tauri、engine、render performance 与 cross-platform 专项边界。另一 alternative 是 domain guilds only，但会失去端到端 handoff owner。

### Decision 2: Project role 与 execution role 分离

`.agents/agents/<role>.md` 定义 mission、scope、inputs、outputs 与 validation，是 project-neutral source of truth。实际派工时，由总负责人把 project role 映射到现有 `plan`、`research`、`implement`、`check`、`debug`、`explorer` 或 `worker` execution role。

不在本 change 复制 `.codex/agents/*.toml`。未来若某角色需要 native registration，只增加最小 host adapter，并继续引用 project role contract。

### Decision 3: 主链是 stateful lifecycle，但不是 rigid all-agent pipeline

Canonical lifecycle：

```text
Intake
  → Spec Ready
  → Impact Known
  → Design Ready
  → Implementation Integrated
  → Verification Passed
  → Review Passed
  → Governance/Release Closed
```

小型 direct edit 可以跳过不适用角色，但不能跳过 PlanFirst、ownership、适用 validation 与 lead acceptance。Bug 任务可走 `research → incident-debugger → quality → review`；behavior feature 走完整主链；performance/security/engine 任务追加对应 specialist gate。

### Decision 4: Handoff artifact 是协作边界

每个 agent 以结构化 artifact 回报，而不是只说“完成”：

| Artifact | Minimum content |
|---|---|
| Requirement Brief | goal、requirements、acceptance、non-goals、OpenSpec mapping |
| Impact Map | relevant specs、data flow、files、risks、recommended ownership |
| Technical Design | decisions、contracts、validation matrix、rollback/compatibility |
| Implementation Report | files changed、behavior、tests、remaining risks |
| Verification Report | commands、results、manual matrix、unverified items |
| Review Findings | severity、file/evidence、required fix、spec drift |
| Closure Report | integrated result、gates、OpenSpec/Trellis/release status、follow-ups |

上游 artifact 不完整时，下游 agent MUST fail visible 并升级给总负责人；不得静默猜测关键 contract。

### Decision 5: 并行单位是 ownership，不是角色数量

- Read-only research/review 可并行，但必须研究不同问题或 gate。
- Write agents 只有在文件/模块 ownership disjoint 且 contract 已冻结时才能并行。
- 共享 constants、types、schema、registry、migration 或同一 spec 由单一 owner 修改；消费者在上游合入后再适配。
- 每个 brief 必须包含 collaboration notice；任何 overlap 先停写并由总负责人 semantic merge。

### Decision 6: Specialist gate 采用 trigger matrix

- UI/interaction/i18n/a11y → `product-design-owner`。
- React rendering、streaming、polling、large list、startup → `performance-reliability-reviewer`。
- auth、secret、external input、filesystem、network、permission、privacy → `security-privacy-reviewer`。
- 新 CLI engine 或 engine registry/provider/session contract → `engine-integration-engineer`，并强制执行仓库 Engine Onboarding Gate。
- docs/instruction/OpenSpec/Trellis lifecycle → `documentation-governance-owner`。
- packaging/signing/updater/deploy/cross-platform release → `release-engineer`。
- 用户研究/问题定义 → `ux-researcher`；a11y/i18n 变化 → `accessibility-localization-reviewer`。
- Tauri shell/window/menu/WebView/OS integration → `desktop-platform-engineer`。
- persistence/schema/migration/backup/compatibility → `data-storage-engineer`。
- automated coverage → `test-automation-engineer`；人工体验/设备/平台矩阵 → `manual-qa-engineer`，二者由 `quality-engineer` 统筹。
- toolchain/build/cache/CI workflow → `build-ci-engineer`；logs/metrics/trace/diagnostics → `observability-diagnostics-engineer`。
- dependency upgrade/license/CVE/lockfile → `dependency-supply-chain-engineer`，security verdict 仍由 `security-privacy-reviewer` 给出。

Trigger 命中后，对应 gate 是 blocking；未命中时 catalog 记录 `not applicable`，不创建无意义工作。

### Decision 7: 共享规则引用 lead contract，避免全文复制

每个角色文件显式声明继承 `doge-project-lead.md` 的共享规则，并只写 role-specific contract。`.agents/agents/README.md` 维护 catalog 和 dispatch matrix；`AGENTS.md` 只增加最小导航指针。

### Decision 8: 以 ECC agent catalog 校准结构，不复制其 host contract

外部参考为 [`affaan-m/everything-claude-code`](https://github.com/affaan-m/everything-claude-code) commit `9b081280bc52ee6f22a2e0463761b318936dd980`（读取时 68 个 agent files）。采用：activation trigger、least-privilege mode、prompt-defense baseline、stepwise workflow、structured output、confidence-filtered review、zero-findings verdict、minimal build repair 与 framework/language review boundary。

不采用：Claude-specific `model/tools` metadata、固定通用 coverage/performance 数字、与 doge stack 不匹配的 commands，以及任何 destructive cache/dependency reset。所有阈值、工具、权限和 gate 仍由 doge current code/spec 决定。

## Risks / Trade-offs

- [Risk] 角色过多导致每次任务启动成本过高 → catalog 标记 role tier 和 trigger，lead 只选择最小闭环 chain。
- [Risk] project role 与 host role 名称不一致 → README 维护 explicit runtime mapping，brief 中同时写 project role 与 execution role。
- [Risk] 多 agent 在共享 worktree 相互覆盖 → write ownership 必须 disjoint；shared contract 由单一 owner；overlap 立即升级。
- [Risk] agent 只交摘要、无法核验 → 所有 handoff artifact 强制包含 paths、commands、results 和未验证项。
- [Risk] `doge-project-lead` 成为 bottleneck → research/review 可并行，lead 只做 decision、integration 与 acceptance，不重复子 agent 已完成的 bounded research。
- [Risk] `.agents/agents/**` 成为新的治理孤岛 → `AGENTS.md` 和 layering guide 提供入口，OpenSpec capability 固化边界。
- [Risk] 外部 agent prompt 被当作权威或含有不安全命令 → 固定 reference commit、只读分析、doge rules 优先，不执行外部 hooks/scripts/install/reset 指令。

## Migration Plan

1. 建立 catalog、role files 与总负责人 dispatch linkage。
2. 更新 `AGENTS.md` 和 instruction-layering guide 的最小导航与 layer ownership。
3. 通过 OpenSpec、frontmatter、link、coverage 与 diff checks。
4. 后续任务逐步使用 catalog；发现职责重叠时先校准 role definitions，再新增角色。

Rollback 只需删除新增 role files、恢复入口指针与 layering 文案；现有 `.codex/agents/*.toml` 和产品 runtime 未修改，因此不会影响现有执行链。

## Open Questions

- 是否将高频 project roles 注册为 host-native agent type，留给后续基于实际 dispatch 频率的独立 change。
- 是否为 catalog 增加 machine-readable manifest，留给未来自动路由/metrics 需求；本轮 Markdown contract 足够。
