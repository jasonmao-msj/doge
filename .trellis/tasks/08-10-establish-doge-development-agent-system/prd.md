# brainstorm: 建立 doge 端到端开发 agent 体系

## Goal

在 `.agents/agents/` 建立一套 project-neutral、可由 `doge-project-lead` 选择性调度的完整开发 agent 体系，覆盖需求、研究、架构、实现、验证、专项风险 gate 与交付收口，使后续端到端任务可以并行协作且保持单一最终责任人。

## OpenSpec Change

- `establish-doge-development-agent-system`

## What I already know

- 用户要求总负责人继续发散并创建其他可能需要的 agent，形成完整闭环。
- `.agents/agents/doge-project-lead.md` 已建立总负责人职责、共享规则和新 agent contract。
- 现有 `.codex/agents/*.toml` 提供 `plan`、`research`、`implement`、`check`、`debug`、`dispatch` 等 host-specific execution roles。
- `AGENTS.md` 要求 PlanFirst、OpenSpec + Trellis 分层、共享工作区保护、semantic merge 和验证闭环。
- `.agents/agents/*.md` 应作为 project-neutral role source；具体 host registration 保持在对应 adapter 层。

## Assumptions (temporary)

- 本轮建立角色定义、catalog、dispatch matrix 和验收 contract，不修改 doge 产品 runtime 的 multi-agent UI/behavior。
- 总负责人按任务风险选择 agent，而不是每次强制运行全部角色。
- project-neutral agent 可以由现有 `research` / `worker` / `implement` / `check` / `debug` execution role 承载；本轮不新增 Codex runtime agent type。
- 核心角色保持精简，专项 agent 通过 trigger gate 按需介入。

## Open Questions

- 无 blocking question；若后续要求将每个角色注册为 host-native agent，再单独扩展 adapter scope。

## Requirements (evolving)

- 建立清晰的 lifecycle stage、角色拓扑、dispatch trigger、handoff artifact 和 escalation path。
- 覆盖 product/spec、research、architecture、UX、frontend、backend/runtime、engine integration、quality、review、debug、performance/reliability、security、release/governance 等端到端能力。
- 按真实软件开发分工补充 UX research、accessibility/i18n、desktop platform、data/storage、test automation、manual QA、build/CI、observability/diagnostics、dependency/supply-chain 等专业工种。
- 每个 agent 遵循 `doge-project-lead.md` 的共享规则和 agent creation contract。
- 并行写入必须拥有互不重叠的 ownership；最终验收责任始终由 `doge-project-lead` 承担。
- catalog 必须说明哪些角色是 always-on、standard、conditional，避免 agent proliferation。

## Acceptance Criteria (evolving)

- [x] `.agents/agents/README.md` 描述完整 lifecycle、角色目录、dispatch matrix 与协作协议。
- [x] 每个角色拥有独立 `<agent-name>.md`，frontmatter name 与文件名一致。
- [x] 所有 agent 文件包含职责、不负责事项、必读上下文、流程、协作、交付物与完成标准。
- [x] 任一常见端到端 feature、bug、performance、security 或 engine onboarding 任务都能映射到明确的 agent chain。
- [x] catalog 形成产品、设计、架构、研发、测试、平台、运维、治理、交付等完整工种矩阵，并明确 owner 与 specialist 的关系。
- [x] 角色职责不存在未解释的重叠，conditional gates 有明确触发条件。
- [x] OpenSpec artifacts 与 Trellis task context 完整，并通过适用 validation。

## Definition of Done (team quality bar)

- Markdown/frontmatter/link/coverage checks 通过。
- `openspec validate establish-doge-development-agent-system --strict --no-interactive` 通过。
- Agent catalog 与总负责人定义一致，不复制 `.trellis/spec/**` 或 `openspec/**` 的治理正文。
- Git diff 无 whitespace error，且无无关文件被修改。

## Out of Scope (explicit)

- 不修改 doge 产品内的 multi-agent inspector、squad UI 或 runtime orchestration behavior。
- 不自动启用全部 agent，不引入新的外部服务或付费依赖。
- 不在本轮 commit、push、创建 PR 或 archive OpenSpec change。
- 不复制现有 `.codex/agents/*.toml` 为另一套 host-specific registration。

## Technical Notes

- Project instruction layering: `.trellis/spec/guides/project-instruction-layering-guide.md`。
- Existing host agents: `.codex/agents/*.toml`。
- Project lifecycle: `.trellis/workflow.md` 与 `openspec/README.md`。
- Agent role source: `.agents/agents/*.md`。

## Research Notes

### Existing patterns

- Trellis pipeline 使用 `plan → research → implement → check → debug/finish` 的 lifecycle role，优点是 handoff 清晰，但 domain specialization 较少。
- doge 产品内 Multi-Engine Collaboration 使用 `plan → approve → implement → review` 的 staged control plane，强调单一 attempt owner、失败可见和串行写入优先。
- `.codex/agents/*.toml` 已提供 host-native execution roles；新增 project roles 应复用这些执行容器，不建立第二套 runtime registry。
- `AGENTS.md`、OpenSpec、Trellis 与 specialist gates 已形成项目质量约束；agent system 应导航到这些事实源，而不是复制正文。
- 外部参考 [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) 在 2026-08-10 GitHub 页面显示 239,299 stars；本次只读校准 commit `9b081280bc52ee6f22a2e0463761b318936dd980` 下的 68 个 `agents/*.md`。
- ECC 值得吸收的结构：activation-aware description、narrow tools/permissions、prompt defense baseline、stage workflow、固定 output format、fresh-context review、confidence filtering、zero-finding acceptance、minimal build repair、language/framework scope split。
- ECC 中 host-specific `model/tools`、通用 coverage/performance 阈值、与 doge 无关的 Web/Next.js 命令和 destructive cache reset 不应直接移植；doge current rules/evidence 优先。

### Feasible approaches

**Approach A: Lifecycle + domain hybrid（Recommended）**

- 主链覆盖 spec、research、architecture、implementation、quality、review、release。
- frontend/backend/runtime/engine/UX 作为 domain agent，performance/security 作为 conditional gate。
- 优点：闭环完整、职责可验证、能并行；缺点：需要 catalog 和 dispatch matrix 控制角色数量。

**Approach B: Six generic lifecycle agents**

- 只保留 plan、research、implement、check、debug、release。
- 优点：简单；缺点：doge 的 Tauri、engine onboarding、render performance 与 cross-platform 风险容易被 generic brief 稀释。

**Approach C: Domain guilds only**

- 以 frontend、backend、engine、QA、security 等领域为中心，不设 lifecycle owner。
- 优点：专业 ownership 强；缺点：需求到交付的 handoff 与最终责任容易断裂。

## Decision (ADR-lite)

**Context**：用户需要可覆盖大量端到端开发任务的完整 agent 体系，同时项目已有 host-native generic roles 和严格治理 gate。

**Decision**：采用 Approach A，并按真实软件团队扩展为 rich workforce。`doge-project-lead` 是唯一 accountable owner；常驻主链角色负责 lifecycle，domain agents 负责写入 ownership，QA/平台/运维/安全等 specialist agents 仅在 trigger 命中时成为 blocking gate。

**Consequences**：agent 数量会多于 generic pipeline，但日常不会全部启动；catalog 必须维护 role tier、runtime mapping、dispatch trigger、handoff artifact 和 overlap rule。Host-native registration 留作后续独立 scope。
