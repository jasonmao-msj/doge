## Why

doge 已有 OpenSpec、Trellis、host-specific agents 与多项专项 gate，但缺少 project-neutral 的角色目录、统一 dispatch contract 和从需求到交付的 agent 闭环。随着端到端任务和并行开发增多，需要由单一总负责人调度专业 agent，同时保护 ownership、事实源与最终验收责任。

## 目标与边界

- 在 `.agents/agents/` 建立 doge 开发 agent catalog，覆盖需求、研究、架构、实现、验证、专项风险与 release closure。
- 以 `doge-project-lead` 为唯一 accountable owner；其他 agent 只拥有被派发的 bounded ownership。
- 定义 lifecycle、dispatch trigger、runtime role mapping、handoff artifact、parallel write rule、escalation 与 completion gate。
- 将 `.agents/agents/**` 纳入项目 instruction layering：project-neutral role source 与 `.agents/skills/**` workflow source 位于共享 agent layer；`.codex/**`、`.claude/**` 只保留 host adapter/registration。

## What Changes

- 新增 `.agents/agents/README.md`，作为角色 catalog、端到端 lifecycle 和 dispatch matrix 的 canonical entry。
- 新增覆盖产品、UX/UI、architecture、frontend、backend/runtime、desktop platform、data/storage、engine integration、QA automation/manual、review/debug、performance/reliability、security/privacy、observability、build/CI、dependency supply-chain、documentation governance 与 release 的丰富工种定义。
- 参考 Everything Claude Code 的 current agent catalog，增加 doge-relevant 的 build-error、silent-failure、type-contract、React/TypeScript、Rust/Tauri、maintainability 与 agent-system evaluator 角色，并把 confidence gate/minimal-diff/prompt-defense 纳入共享 contract。
- 校准 `doge-project-lead`，让其按 catalog 选择 agent、控制 parallel ownership，并完成最终 semantic integration。
- 更新项目入口与 instruction-layering guide，使后续 session 能发现 project-neutral agent system，且不与 host-specific config 重复维护。
- 新增 OpenSpec capability，固化 agent catalog、dispatch、handoff 与 closure behavior。

## 技术方案取舍

### Option A: Lifecycle + domain hybrid（选择）

使用少量 lifecycle owner 串起主链，并用 domain agents 承接实现 ownership；performance/security 等 specialist 仅在 trigger 命中时进入 blocking gate。它能覆盖 doge 的 cross-layer、Tauri、engine onboarding 与性能风险，同时避免每次全量启动 agent。

### Option B: Generic lifecycle only

只使用 `plan/research/implement/check/debug/release`。维护成本低，但 domain context 容易被稀释，尤其无法稳定承载 engine onboarding、render performance、cross-platform 与 UX/a11y 专项约束。

### Option C: Domain guilds only

仅按 frontend/backend/engine/QA/security 分组。专业 ownership 清晰，但 requirement、handoff、closure 和最终 accountable owner 容易断裂，不满足端到端闭环目标。

## Capabilities

### New Capabilities

- `development-agent-orchestration`: 定义 doge 开发 agent catalog、role tiers、dispatch contract、handoff artifacts、parallel ownership、specialist gates 与 closure rules。

### Modified Capabilities

- `project-instruction-layering-governance`: 将 `.agents/agents/**` 与 `.agents/skills/**` 纳入共享 agent instruction layer，并明确其与 `.codex/**`、`.claude/**` host adapters 的 source-of-truth 边界。

## 验收标准

- `.agents/agents/README.md` 能把常见 feature、bug、performance、security 与 engine onboarding 任务映射到完整 agent chain。
- 每个 agent 文件具有唯一 name、明确 scope/non-goals、必读上下文、handoff、validation 和 escalation contract。
- catalog 区分 core、standard 与 conditional roles；专项 agent 不会无条件全部运行。
- catalog 明确 QA owner 与 test automation/manual QA、backend/runtime 与 desktop/data specialists、security 与 dependency supply-chain 等 owner/specialist 关系。
- 并行写入要求 disjoint ownership，任何 agent 结果都必须回到 `doge-project-lead` 做 integration 与最终验收。
- 项目入口与 layering guide 能导航到 agent catalog，且 host adapters 不复制 project-neutral 职责正文。
- OpenSpec strict validation、Markdown/frontmatter/link/coverage checks 与 `git diff --check` 通过。
- 外部参考固定到已记录 commit，只吸收 role design pattern，不执行或复制其不受信任 scripts/hooks/host-specific commands。

## 非目标

- 不修改 doge 产品内 Shared Session、squad、Inspector 或 multi-agent runtime behavior。
- 不新增 Codex/Claude runtime agent type，不把每个 project role 强制注册为 host-native agent。
- 不要求所有任务运行全部 agent，也不允许多个写 agent 在重叠 ownership 上并行。
- 不在本 change 自动 commit、push、创建 PR 或 archive。

## Impact

- Project-neutral agent definitions: `.agents/agents/**`
- Project entry and governance: `AGENTS.md`、`.trellis/spec/guides/project-instruction-layering-guide.md`
- Behavior artifacts: `openspec/changes/establish-doge-development-agent-system/**`
- Task tracking: `.trellis/tasks/08-10-establish-doge-development-agent-system/**`
- Host-specific `.codex/agents/*.toml`、`.claude/**` 与 doge product runtime 不变。
