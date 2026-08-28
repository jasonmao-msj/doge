## MODIFIED Requirements

### Requirement: Composer context SHALL fan into first stage only

系统 MUST 将 Composer 上下文（图片、skill、记忆、便签，可多条）以及**主幕已有对话 digest**（若有）对齐注入模板首段，后续段仅消费首段文字归纳与上游 stage 产出，禁止整类拒绝或静默丢弃。有主幕历史时 MUST 注入 digest；空历史可跳过。

#### Scenario: images and context allowed on collab submit

- **WHEN** 用户开启协作并附带图片和/或 skill/记忆/便签后发送
- **THEN** 系统 MUST NOT 因「协作暂不接收附件/上下文」拦截
- **AND** 首段 worker turn MUST 收到注入后的 model text 与（若有）images

#### Scenario: main-canvas history fans into first stage model text

- **WHEN** 用户在已有主幕对话的会话上开启协作发送
- **THEN** 首段 model text MUST 在本轮用户任务前包含主幕对话 digest 标记块（`【主幕对话上下文】`）
- **AND** `visibleText` / 主幕用户气泡 MUST NOT 包含该 digest 块

#### Scenario: dispatch falls back to durable image_refs

- **WHEN** 协作 drive 调用 `shared_session_v2_dispatch_turn` 且未传 `images`
- **AND** 对应 attempt 的 `TurnRequested.input.image_refs` 非空
- **THEN** 系统 MUST 用 `image_refs[].locator` 作为 CLI 附图路径
- **AND** MUST NOT 静默丢弃 durable 附图

#### Scenario: image-only collab request is accepted

- **WHEN** 用户开启协作、只附图不写正文后发送
- **THEN** 系统 MUST 接受请求（不得因 empty text 拒绝）
- **AND** 首段 prompt MUST 使用占位任务文案并附带 images

#### Scenario: memory and note-card bodies fan into first-stage model text

- **WHEN** 协作发送携带 selectedMemoryIds 和/或 selectedNoteCardIds
- **THEN** 首段 `request_text` / model text MUST 包含记忆/便签注入块
- **AND** 主幕 visible text MUST NOT 包含上述注入块
- **AND** 便签附图 MUST 并入 firstStageImages（走附图 SSOT）

#### Scenario: skill bodies are injected for collab first stage

- **WHEN** 协作发送携带 skillInvocations（含 path）
- **THEN** 系统 MUST 读取 SKILL.md 并将正文注入首段 model text
- **AND** MUST NOT 仅依赖编排 prompt 中间的 `/skill` slash 解析作为唯一通道
- **AND** 读文件失败时 MAY 保留 slash token 作为引擎回退

#### Scenario: non-first stages receive text summary only

- **WHEN** 首段已成功并启动后续 stage
- **THEN** 后续 stage begin turn MUST NOT 附带 first-stage images
- **AND** 后续 prompt 的「用户任务」MUST 使用 `userVisibleText`（无记忆/skill/主幕 digest 注入块）
- **AND** 后续 prompt MUST 可依赖 plan / short_outcome / upstream notes 中的文字归纳
