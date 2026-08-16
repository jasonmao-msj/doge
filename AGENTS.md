<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:
- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:
- Development workflow (`workflow.md`)
- Project structure guidelines (`spec/`)
- Developer workspace (`workspace/`)

If you're using Codex, project-scoped helpers may also live in:
- `.agents/skills/` for reusable Trellis skills
- `.codex/agents/` for optional custom subagents

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->

# 项目规则入口（doge）

## 规则优先级

- 当前项目代码实现 > 项目内文档（`AGENTS.md` / `.trellis/spec/**` / `openspec/**`）> 全局 `~/.codex/rules/*` / 全局 `~/.codex/AGENTS.md`
- 文档主体使用中文，technical terms 保留 English
- AI 写 OpenSpec proposal / design / tasks / spec delta 时，必须采用中英文结合：中文用于业务判断、风险、实施顺序和验收口径，English technical terms、文件名、函数名、命令、metric id、chunk 名保持原文

## 文档分层

本仓库将规则与状态分成五层：

1. **Project entry**：`AGENTS.md`
   - 只负责规则优先级、最小读取路径、全局 gate、分层指针
2. **Implementation rules**：`.trellis/spec/**`
   - frontend / backend / guides 的具体实现规范
3. **Behavior specs**：`openspec/**`
   - proposal / design / tasks / main specs / workspace governance
4. **Agent workflow + host adapter config**：`.agents/**`、`.claude/**`、`.codex/**`
   - `.agents/agents/**`：project-neutral agent roles 与 dispatch catalog
   - `.agents/skills/**`：project-neutral reusable workflows
   - `.claude/**`、`.codex/**`：hooks / commands / registration / host-specific glue
5. **Runtime artifacts**：`.omx/**` 及其他本地运行态目录
   - 不是长期仓库资产，不作为规范事实源

## 最小读取路径

- 开始任务先读本文件。
- 涉及实现时，再按需读：
  - `.trellis/spec/frontend/index.md`
  - `.trellis/spec/backend/index.md`
  - `.trellis/spec/guides/index.md`
  - 若任务本身在改规则入口或文档边界，再读 `.trellis/spec/guides/project-instruction-layering-guide.md`
- 涉及 behavior/change/workflow 时，再读：
  - `openspec/README.md`
  - `openspec/project.md`
  - 对应 `openspec/changes/<change-id>/**`
- 涉及 multi-agent 拆分、delegation 或并行开发时，再读：
  - `.agents/agents/README.md`
  - `.agents/agents/doge-project-lead.md`
- 只有在调试 host hooks / commands / skills 时，才优先深入 `.claude/**` 或 `.codex/**`。

## OpenSpec + Trellis

- `openspec/**` 是 behavior / proposal / change 的 single source of truth。
- `.trellis/spec/**` 是 code-level rule 与 executable contract 的沉淀位置。
- `.trellis/tasks/**` 是执行容器；每个 Trellis task 都必须关联一个 OpenSpec change。
- 涉及行为变更、产品交互、跨层 contract 变更时：
  1. 先创建或选择 OpenSpec change
  2. 再进入 Trellis / implementation
  3. 实现后同步更新相关 spec，并执行 verify / sync / archive 流程

## 实现入口

- frontend / backend / cross-layer 详细规则不要写回 `AGENTS.md`。
- 这类细则统一维护在 `.trellis/spec/**`：
  - frontend: `component-guidelines.md`、`hook-guidelines.md`、`state-management.md`、`quality-guidelines.md`、`type-safety.md`
  - backend: `directory-structure.md`、`error-handling.md`、`logging-guidelines.md`、`database-guidelines.md`、`quality-guidelines.md`
  - cross-layer / reuse / shell / unified-exec: `.trellis/spec/guides/**`

## 全局 Gate

### Trellis Session Record

- AI 在本仓库成功执行 `git commit` 后，必须继续执行 Trellis session record，除非用户明确要求跳过。
- record 前先运行 `python3 ./.trellis/scripts/get_context.py --mode record`，不得猜测 developer id。
- 所有 Trellis 路径使用 repo-relative path，禁止写死个人绝对路径。

### Git Commit Message

- 默认必须使用中文主体的 Conventional Commits：`type(scope): 中文动宾短句`
- 若仓库脚本或 workflow 与此冲突，先修正规则或配置，再提交

### PlanFirst

- 任何代码、配置、规范落盘前，先给出 `PLAN` 或等价 OpenSpec artifact。
- 若任务已进入 OpenSpec workflow，则以 OpenSpec artifact 作为 plan 载体。

### Engine Onboarding Gate

- 接入新 CLI engine（或恢复/变更既有 engine 的接入面）前，必读 `docs/research/mossx-multi-cli-provider-session-foundation-design.md`（基石设计）与 `docs/research/mossx-new-cli-onboarding-guide.md`（全量接入点核对矩阵）。
- 实施必须按核对矩阵 §0 逐层勾选；⚠ 标记的静默失败点全部人工核对，🔵 按需在 PR 描述写决策记录。
- PR 描述须附矩阵完成度说明、渲染层目视验收结果与受影响 CI gate 运行结果。

### ADR 校准回写 Gate

- OpenSpec change 收口 / archive 前，若变更命中基石文档「更新触发器」（engine registry、Shared 支持集合、provider binding、canonical fact schema、context compiler、terminal/ACK contract、recovery exit / abandon），必须同步刷新 `docs/research/mossx-multi-cli-provider-session-foundation-design.md` 的「最近校准」标注与「零、当前实现校准」表。
- 校准行必须带可核对的代码事实源（repo-relative 文件路径或 OpenSpec change id），禁止只写概念。
- 未回写的 change 不得标记收口 / 归档；本 gate 由 `$finish-work` 与 archive 流程共同把关。

### Merge Guardrails

- 高风险文件冲突时，禁止整文件 `--ours` / `--theirs` 覆盖。
- 必须先列 capability matrix，再做 semantic merge，并验证关键 symbol / tests / contract command。

### Shell Baseline

- 遇到 `command not found`，先执行：
  - `zsh -lc 'source ~/.zshrc && <command>'`
- 仍失败再排查：
  - `zsh -lc 'source ~/.zshrc && which <command> && echo $PATH'`

### Render Perf Baseline

- 2026-07-08 实验基线曾观察到 AppShell 根渲染单次阻塞主线程 100~350ms；该数值是有日期的历史测量，不是永久 current value。改动对话/流式/后台任务链路前，读 `docs/perf/render-jank-knife-experiments-2026-07-08.md`（四层根因），并以重新测量结果为准。
- 硬红线：① 高频 setState（每事件/日志/轮询级）禁挂根 hook 链；② 数组追加型 setState 禁入根链；③ 根链 store 用事件驱动 + ≥30s 兜底轮询，禁秒级轮询；④ 流式正文走 `liveAssistantTextChannel`（flag `liveTextExternalization` 默认开），禁恢复逐 delta dispatch 进 reducer。
- 渲染风暴排查用归因面板 + React `memoizedUpdaters` 追踪（复现指南见上述文档 §七）；react-scan 2~3x 放大，测量前关。

### Native WebView API Gate（2026-08-06 uiScale P0 沉淀）

- 调用任何 native / WebView 系统能力（zoom、DPI、窗口、透明度、Tauri command）前，必读 `.trellis/spec/guides/native-webview-api-risk-gate.md` 并过三问：① 有无纯 Web 替代（有则一律用，如 CSS `transform: scale()` 替代 native zoom）；② 出错用户能否自救；③ 验收矩阵是否覆盖平台 × 取值 × 系统 DPI。
- 「启动时生效的持久化设置」若错误值可致起不来 / 进不了设置页，必须配 startup guard（模板 `src/utils/uiScaleStartupGuard.ts`）：危险值留 pending 记录，未证明健康则下次会话临时回退安全值，**禁止改写用户存储**，禁止拿 timeout 当修复。
- 平台结论必须按证据分级（已证实 / 已排除 / 未验证）；「没接到投诉」不算安全证据。

## 仓库卫生

- `.omx/**`、`.trellis/.developer`、`.trellis/.current-task` 等本地 state 属于 runtime artifact 或 local-only state。
- 这类目录和文件不作为规范事实源；若误入库，应按仓库卫生规则清退并加入忽略策略。
