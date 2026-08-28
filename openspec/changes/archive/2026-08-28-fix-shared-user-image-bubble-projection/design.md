## Context

Shared Session V2 发送链：

1. FE optimistic 用户气泡（含 `images`）
2. `begin_turn` Tx1 写 `TurnRequested`（当前 `image_refs: None`）
3. `dispatch_turn` 把 `images` 交给各引擎 runtime（识图正常）
4. `SharedProjector` 把 turnRequested 投成用户 `message`（仅 text）
5. FE dataSource 映射为 `ConversationItem`（无 images）
6. optimistic merge：`isEquivalentUserObservation` 要求 text+images 一致

结果：有图 optimistic 与无图权威消息要么双留（多气泡），要么保守替换后丢图（图2）。

这是 **shared CLI 共有路径**（`shared_session_v2`），与具体引擎无关。

## Goals / Non-Goals

**Goals:**

- 用户附图进入 durable fact → projection → canvas 用户气泡。
- optimistic 与权威消息在附图维度可收敛为单条。
- 全 Shared 引擎行为一致。

**Non-Goals:**

- 不实现远端对象存储 / CDN 附图。
- 不改变 dispatch 识图协议。
- 不处理 assistant 生成图（`generatedImage`）。

## Decisions

### D1: 在 Tx1 `begin_turn` 写入 image_refs（而非仅 dispatch）

- **选择**：`begin_turn_core` / `shared_session_v2_begin_turn` 增加可选 `images: Vec<String>`，在 `TurnRequested.input.image_refs` 落盘。
- **理由**：durable-first；projection 可在 runtime 完成前就有用户气泡权威源。
- **备选**：dispatch 后再补写 fact → 崩溃窗口丢图、违背 Tx1 边界。

### D2: ArtifactRef 用本地路径 locator + 内容/路径 hash

- **选择**：对每个 path 构造 `ArtifactRef`：`locator=path`，`mediaType` 按扩展名猜测，`sha256` 优先文件内容 digest，文件不可读时用 path bytes digest（保证 validator 64 hex）。
- **理由**：validator 强制合法 ArtifactRef；UI 只需 locator 展示。
- **备选**：绕开 image_refs 塞 extra 字段 → 与 canonical 合同不一致。

### D3: Projection message content 带 `images: string[]`（locator 列表）

- **选择**：`project_turn_requested` content 增加 `images: [locator, ...]`，与 Native `ConversationItem.images` 对齐。
- **理由**：FE 已有 MessageRow 附图渲染；不引入 generatedImage 误用。
- **备选**：为每张图额外投 `generatedImage` item → 语义错误（用户附图 ≠ 模型出图）。

### D4: FE dataSource 映射 images

- **选择**：`toConversationItem` message 分支读取 `content.images` 为 `string[]`。
- **理由**：补齐与 projector 的契约。

### D5: optimistic merge 安全网

- **选择**：当 text 等价但 images 不等时：
  - 优先采用「非空 images 并集/权威侧补全」后单条收敛；
  - 禁止同时保留有图 optimistic 与无图 real。
- **理由**：历史 fact 无图时仍尽量保住本地展示；新 fact 有图后自然等价替换。

### D6: FE begin_turn 传 images

- **选择**：`sharedSessionV2BeginTurn(..., text, images?)`；`sendSharedSessionTurnV2` 在 Tx1 传入 `input.images`。
- **理由**：与 dispatch 同源附图列表。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| 文件被删后 sha256 只能 path-hash | locator 仍可用于 LocalImage 尝试；展示失败时降级为无图但不双气泡 |
| 大图读盘算 hash 阻塞 begin | 同步读本地 path（composer 附件已是本地文件）；若 profile 显示瓶颈再改为 path-only hash |
| 旧 session 无 image_refs | 仅新 turn 修复；merge 安全网尽量保住当前会话 optimistic 图 |
| ArtifactRef 校验失败导致 begin 失败 | 过滤空 path；构造前保证 sha256 合法 |

## Migration Plan

1. 部署后新 Shared 附图 turn 自动带 image_refs。
2. 旧 turn 无图元数据：无法复原历史附图（已知限制）。
3. 回滚：回退 begin/projector/dataSource/merge；旧客户端忽略多余 images 字段。

## Open Questions

- 无（路径与合同已闭合）。
