# React #185 Maximum Update Depth Playbook

> **文档性质**：可追加 living playbook（依据文档），不是一次性事故报告。
> **用途**：冷启动 / 渲染过程中再次出现 React `#185`（`Maximum update depth exceeded`）时，按本文件诊断、归类、修复与归档。
> **事实边界**：行为以当前代码 + OpenSpec main specs 为准；本文件记录诊断协议与历史 case，不自动证明 `HEAD` 已全部收敛。

---

## 1. 错误是什么

| 字段 | 含义 |
|------|------|
| Production message | `Minified React error #185` |
| 完整语义 | `Maximum update depth exceeded` |
| 触发条件 | 同一更新链内嵌套 `setState` 超过 React 限制（常见 ~50 次） |
| 用户表现 | 全局 `ErrorBoundary` 替换 AppShell；`errorClass: react-maximum-update-depth` |
| 报告入口 | `src/components/errorBoundaryReport.ts` / `ErrorBoundary.tsx` |

解码：

- 完整说明：<https://react.dev/errors/185>
- 本仓库报告分类：`classifyErrorBoundaryError` → `react-maximum-update-depth`

---

## 2. 诊断协议（以后必走）

### 2.1 收集证据（content-safe）

1. ErrorBoundary 完整报告（含 `generatedAt` / `appVersion` / componentStack / stack）
2. 是否冷启动 / 切换 workspace / 流式结算 / 打开 Settings
3. reload 是否恢复
4. 若有 production bundle 哈希（如 `App-BhVHLEiP.js`），与本地 `dist/assets` 对齐
5. **禁止**把 prompt / message / 文件内容写入 case 记录

### 2.2 反查 minified stack

1. 用 `function XXX(` 在对应 chunk 中定位 mangled 组件名
2. 用栈帧 `file:line:col` 截取附近代码，优先找 `useLayoutEffect` / `useEffect` + `setState`
3. componentStack 最内层通常是真正在循环写 state 的组件；外层多为 AppShell / router

### 2.3 复现门禁

优先写 **可执行 regression**（Vitest + jsdom / StrictMode），而不是只靠手动冷启动：

- 语义等价 state 反复 commit 不得出现 `#185`
- 真实 observable 变化仍须发布
- 有界 tick 后 state 收敛

### 2.4 修复优先级（强制）

| 优先级 | 做法 | 何时用 |
|--------|------|--------|
| **P0 根因** | 合并双写、统一纯函数语义、幂等 commit | 默认 |
| P1 结构 | 派生值改 `useMemo`，不落 React state | derived projection |
| ❌ 禁止 | 提高 React update limit、ErrorBoundary 吞错自动 reload 当修 | 掩盖根因 |
| ❌ 禁止 | 清理用户 local store 当“修复” | 不可复现、不可回归 |

---

## 3. 反模式目录（追加时只加条目，不改编号语义）

| ID | 反模式 | 典型症状 | 正确收敛 |
|----|--------|----------|----------|
| AP-01 | **双 effect 对打** | A 写 `null`，B 写 `default`，layout/effect 互踩 | 单源 pure plan + 单一 apply |
| AP-02 | **语义不等价却每次 setState** | 值相同仍 `setState(newRef)` | functional update：`prev === next ? prev : next` |
| AP-03 | **derived 存 state 并订阅上游引用** | 上游等价换引用 → effect 刷新 → 父 rerender | state 只存 source；projection `useMemo` |
| AP-04 | **repair effect 订阅自身写入结果** | reload 写 cache，cache 再触发 reload | 读 ref / 外部 store，写走 equality gate |
| AP-05 | **async refresh 把 selection 放进 deps** | selection 变 → refresh 重建 → 再写 selection | snapshot ref 读最新值 |
| AP-06 | **第三方 ref / presence 版本抖动** | Radix ScrollArea / Tooltip 在 React 19 下 ref loop | 稳定 ref identity 或换实现 |

---

## 4. 修复设计原则（写代码前勾选）

- [ ] **Single planner**：model/effort（或其它成对 state）用纯函数一次算出
- [ ] **Single applier**：layout 与 async 路径共用同一 apply
- [ ] **Idempotent commit**：normalize 后相等不写
- [ ] **No competing backfill**：禁止“主收敛 + 旁路补洞”两套语义
- [ ] **Stable business locks**：用户显式选择不被 preferred 漂移覆盖（除非产品明确要求）
- [ ] **Regression first**：先红后绿，或至少与修复同 PR 落地可执行测试
- [ ] **Scope**：不顺手大重构无关 AppShell；diff 可审查

---

## 5. Case Log（只追加，不改写旧 case 结论）

> 新 case 模板见 §6。编号 `C-YYYYMMDD-NN`。

### C-20260801-01 — useModels effort 双写死循环（冷启动）

| 字段 | 内容 |
|------|------|
| **状态** | fixed（结构加固） |
| **Fix commit** | `4c5e97c8e` — `fix(models): 结构性修复冷启动 React #185 effort 双写死循环` |
| **现象** | 冷启动全局 Application Error；`errorClass: react-maximum-update-depth`；`appVersion` 可能为 `unknown` |
| **Bundle / 栈** | `App-BhVHLEiP.js`；componentStack `GWt`=AppShell；栈帧落在 `useModels` 的 selection `useLayoutEffect` |
| **Owner** | `src/features/models/hooks/useModels.ts` |
| **触发条件** | `supportedReasoningEfforts === []` 且 `defaultReasoningEffort` 非空，且 `preferredEffort === null`（例如 settings `lastComposerReasoningEffort: null`；`lastComposerModelId` 可为跨引擎残留如 `k3`） |
| **根因（AP-01）** | ① selection `useLayoutEffect` 经 `resolveEffort` 在 empty-supported 时只回 `preferredEffort`（常为 `null`）并写入；② 独立 backfill `useEffect` 在 effort 为空时写 `model.defaultReasoningEffort` → 对打至 #185 |
| **止血** | empty-supported 时 `preferred ?? modelDefault`（语义对齐） |
| **结构加固** | 见下表 |
| **回归** | `src/features/models/hooks/useModels.test.tsx`（#185 场景 + pure plan 稳定性 + 用户锁定 effort） |
| **关联历史** | 仓库曾多次修冷启动 #185（Tooltip / ScrollArea / Quick Switcher / Agent selection / Composer cache）；**本 case 是独立 owner，不是 Quick Switcher 复发** |
| **索引** | [`docs/analysis/README.md`](./README.md) |

**结构加固要点（C-20260801-01）**

| 机制 | 实现 |
|------|------|
| Pure effort 解析 | `resolveModelEffort()` — 唯一 effort 语义 |
| Pure selection 规划 | `planComposerModelSelection()` — layout / refresh 共用 |
| 幂等 commit | `commitSelectedModelId` / `commitSelectedEffort` |
| 单同步收敛入口 | 一个 `useLayoutEffect` apply plan |
| 删除互踩 writer | 移除 effort backfill effect、空白串 normalize effect（normalize 并入 commit） |
| Async 解耦 | `selectionSnapshotRef`，`refreshModels` 不再订阅 selection state deps |
| 业务锁 | 用户显式 effort 或「用户锁 model 且已有 effort」时 preferCurrent，避免 preferred 漂移 |

**Code review 摘要（C-20260801-01 加固后）**

| 项 | 结论 |
|----|------|
| 根因是否切断 | 是：双 writer 合并为 plan→apply；empty-supported 与 default 同语义 |
| 业务是否易漂 | 中低风险：刻意保留用户锁 model/effort 行为；需靠测试钉死 |
| 残余风险 R1 | layout 仍把 `selectedModelId`/`selectedEffort` 列入 deps，依赖幂等 commit 停环；若未来 commit 被旁路 raw setState，可能复发 |
| 残余风险 R2 | runtime-only 模型若 empty supported 且 **无** default，effort 仍可为 null（正确）；UI 需能接受 |
| 残余风险 R3 | `mergeCodexSelectableModels` 对 catalog 外模型不会 hydrate STANDARD efforts；与 #185 无关，但是 effort 元数据质量债 |
| 建议后续 | 见 §7 backlog；新 #185 勿直接改 limit，先按 §2 归因 |

---

## 6. 新 Case 追加模板

复制到 §5 末尾：

```markdown
### C-YYYYMMDD-NN — <一句话标题>

| 字段 | 内容 |
|------|------|
| **状态** | open / fixed / wontfix |
| **现象** | |
| **Bundle / 栈** | |
| **Owner** | path + 符号 |
| **触发条件** | |
| **根因（AP-xx）** | |
| **修复** | 止血 / 结构（分列） |
| **回归** | 测试路径 |
| **Review 要点** | 残余风险 / 不变量 |
```

---

## 7. 后续加固 Backlog（可勾选推进）

- [ ] **B1** layout 收敛仅依赖 catalog/preferred；selection 经 ref 读取，进一步降低 self-deps（验证用户 setSelection 后仍能补齐空 effort）
- [ ] **B2** AppShell `usePersistComposerSettings` 与 thread repair：审计是否与 `useModels` 形成跨 hook 反馈（preferred ↔ selected 往返）
- [ ] **B3** runtime 空 reasoning metadata 的 hydrate 策略产品化（catalog 内 merge vs catalog 外 STANDARD fallback）
- [ ] **B4** ErrorBoundary 报告稳定注入 `appVersion`（避免 `unknown` 干扰归因）
- [ ] **B5** 将本 playbook 关键到 `openspec/specs/client-renderer-stability-under-pressure` 的诊断入口（仅文档指针，不扩 scope）
- [ ] **B6** 冷启动 fixture：真实 persisted shape（跨引擎 lastComposerModelId + null effort）进 `app-shell.startup.test.tsx`

---

## 8. 历史相关入口（索引，非完整列表）

OpenSpec / 代码中已出现的 #185 类修复（便于对照，**不等于本 playbook 已覆盖**）：

- Tooltip startup：`tooltip-icon-button-startup-stability`
- Sidebar ScrollArea React19：`sidebar-scroll-area-react19-stability`
- Quick Switcher / cold-start collection：`fix-cold-start-update-depth-loop`、`fix-messages-core-update-depth-loop`
- Agent catalog：`agent-startup-selection-stability`
- Composer selection：`codex-composer-startup-selection-stability`
- 分类与报告：`src/components/errorBoundaryReport.ts`
- 本 case 代码：`src/features/models/hooks/useModels.ts`
- 本 case 测试：`src/features/models/hooks/useModels.test.tsx`

---

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-01 | 初版：协议 + AP 目录 + C-20260801-01（useModels）+ backlog |
| 2026-08-01 | 校准：C-20260801-01 补 fix commit `4c5e97c8e`；挂 analysis 索引 |
