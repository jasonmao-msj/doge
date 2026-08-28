## Why

主幕布已有多轮对话后触发协作时，首节点 worker 是独立 binding，当前只注入本轮用户输入（+ skill/记忆/便签/图），**缺少主幕当时已有对话上下文**。用户说「按上面做」时首节点会冷启动，不合理。

## 目标与边界

| ID | 目标 | 可测定义 |
|----|------|----------|
| G1 | 主幕有历史时首节点 prompt 头部含主幕对话 digest | `squadRequest` 路径 `modelText` / 首段 `request_text` 含 `【主幕对话上下文】` 块 |
| G2 | 主幕无历史时零行为 diff | 空线程触发协作 → 不注入该块 |
| G3 | 不破坏现有交互 | 主幕气泡、模板、stage 隔离、后续段 fan-in、Inspector 交互均不变 |
| G4 | 有预算上限 | digest 总字数有 cap；超长截断 |

### 边界

- **仅** Shared 协作 `squadRequest` 发送路径的 **首段 model text** 头部注入。
- 材料来自触发瞬间主幕 `itemsByThread` 中已有 user/assistant 文本消息。
- 不改 worker binding 模型、不改后端 `begin_stage_turn` 契约、不改后续段 upstream。

## 非目标

| 项 | 原因 |
|----|------|
| 首 worker resume 主会话 binding | 破坏 stage 隔离与 multi-CLI 模型 |
| Inspector 注入上下文 UI 扩展 | 本波小手术；prompt 侧已生效即可 |
| 主幕历史进 subsequent ordinary turn compiler | 已有 collab stage context change 覆盖另一方向 |
| 全量 rematerialize / 无 cap 全历史 | budget 失控 |
| 改模板 UI / 批准流 / 汇总 turn | 范围外 |

## What Changes

- 新增纯函数：从主幕 `ConversationItem[]` 组装主幕对话 digest，并 **prepend** 到协作首段 `modelText`。
- `useThreadMessaging` 协作发送路径：在 skill/记忆/便签注入**之前或并列**，对「触发前已有历史」注入主幕上下文块（不含本轮即将发送的用户句，避免与 `用户任务` 重复）。
- 过滤：协作内部调度标记、hist-fold、空正文；仅 user/assistant 消息。
- 单测 + OpenSpec delta。

## Capabilities

### New Capabilities

- `collab-first-stage-main-canvas-context`：主幕触发协作时首段注入主幕对话上下文的契约。

### Modified Capabilities

- `multi-agent-orchestration`：Composer Context Fan-in 扩展为 MUST 含主幕对话 digest（有历史时）。

## Impact

| 层 | 触点 |
|----|------|
| Frontend | `multi-agent/runtime` 新 inject 工具；`useThreadMessaging` squad 路径一行接入 |
| Backend | **无**（复用现有 `request_text` / 首段 prompt） |
| UI 交互 | **无**可见交互变更（仅模型入站上下文） |

## 技术方案对比与取舍

| 方案 | 说明 | 取舍 |
|------|------|------|
| B. 首 worker resume 主 binding | 真共享历史 | **拒绝**：破坏隔离与 multi-CLI |
| C. 仅最后一轮 assistant | 轻量 | 弱；长上下文仍丢 |
| **A. 首段 prompt 头部 digest（采用）** | 与 skill/记忆 fan-in 同构；零 binding 变更 | **采用** |

## 验收标准

1. 主幕先聊 ≥1 轮再开协作：首段 worker 入站文本含 `【主幕对话上下文】` 与历史要点。
2. 空线程首发协作：无该标记；skill/记忆/图行为不变。
3. 主幕用户气泡仍只显示本轮可见原文（不把 digest 写进用户气泡）。
4. `visibleText` / 主幕气泡不受 digest 污染。
5. focused Vitest 通过；**不提交**，作者 review 后用户验收。
