## ADDED Requirements

### Requirement: First collab stage MUST receive main-canvas dialogue digest when history exists

当用户在**已有主幕对话**的 Shared 会话上通过 Composer 开启协作（`squadRequest`）时，系统 MUST 将触发瞬间主幕已有 user/assistant 文本对话组装为 digest，并注入**首段** worker 的 model text **头部**。

#### Scenario: non-empty main canvas injects header block

- **WHEN** 主幕 `itemsByThread` 在触发前至少有一条非空 user 或 assistant 文本消息
- **AND** 用户发送协作请求
- **THEN** 首段 `request_text` / model text MUST 以 `【主幕对话上下文】` 标记块开头（或该块位于 skill/记忆块之前、本轮任务句之前）
- **AND** digest MUST 包含至少一条历史消息要点
- **AND** 主幕用户气泡 / `visibleText` MUST NOT 包含该标记块

#### Scenario: empty main canvas skips injection

- **WHEN** 主幕无历史文本消息（空线程或仅非 message 项）
- **AND** 用户发送协作请求
- **THEN** model text MUST NOT 包含 `【主幕对话上下文】`
- **AND** 既有 skill/记忆/便签/图 fan-in 行为 MUST 保持不变

#### Scenario: collab-internal and fold items are excluded

- **WHEN** 主幕历史中存在协作内部调度文案（briefing/summary marker）或 multi-agent hist-fold 项
- **THEN** digest MUST NOT 将这些正文作为可消费对话行注入

#### Scenario: budget caps apply

- **WHEN** 主幕历史总长超过实现定义的总 cap（≥ 6000 字符量级）或单轮超 cap
- **THEN** 系统 MUST 截断或丢弃更旧轮次，保留较近对话
- **AND** MUST NOT 因历史过长阻断协作发送

### Requirement: Injection MUST NOT change collab interaction surface

主幕对话上下文注入 MUST 仅为模型入站文本变更，不得改变用户可见协作交互。

#### Scenario: user-visible collab UX unchanged

- **WHEN** 带主幕历史触发协作
- **THEN** 主幕仍只展示本轮可见用户原文（及既有 sticky/折叠叙事）
- **AND** 模板选择、stage 流水线、批准/重试/汇总交互 MUST 与注入前一致
- **AND** 后续 stage 仍仅消费用户可见任务 + 上游 stage 产出（不因本 change 改为全量主幕历史）
