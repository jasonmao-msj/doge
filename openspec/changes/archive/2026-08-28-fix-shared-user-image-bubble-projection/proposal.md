## Why

Shared CLI 会话（Claude / Codex / Grok / Kimi / OpenCode 共用 V2 发送路径）在发送「文字 + 图片」时出现幕布 UI 缺陷：

1. **多出一个用户气泡**：optimistic 有图气泡与 projection 无图气泡并存。
2. **有时丢失图片展示**：optimistic 被无图权威消息替换后，气泡只剩文字；但模型侧仍通过 dispatch RPC 收到 images，能正常识图。

根因是 Shared 共有链路：`TurnRequested` 固定 `image_refs: None`，projector / FE dataSource 也不透传用户附图，而 equivalence 合并要求 text+images 一致——导致双留或丢图。这是 **shared CLI 共性问题**，不是某一引擎专属。

## What Changes

- Tx1 `begin_turn` 接收并持久化用户 `images` → `CanonicalUserInput.image_refs`。
- `SharedProjector.project_turn_requested` 将用户附图路径写入 projection message content。
- FE `sharedProjection/dataSource` 映射 `message.images` 到 `ConversationItem.images`。
- FE `shared_session_v2_begin_turn` 调用携带 images（与 dispatch 对齐）。
- optimistic 合并加固：有图 optimistic 与无图/部分图权威消息收敛时保留附图，避免双气泡与丢图。
- 补齐 Rust / Vitest 回归。

## 目标与边界

- **目标**
  1. Shared 任意引擎：一条「字+图」用户输入 → 幕布 **仅一条**用户气泡且 **展示附图**。
  2. 刷新 / projection rebuild 后仍能展示附图（durable projection，非仅 optimistic）。
  3. 模型识图路径不变（dispatch images 已通）。
  4. Native 会话与无图 Shared 发送无回归。
- **边界**
  - Shared V2 canonical projection + optimistic merge + FE dataSource。
  - 不改引擎协议、不改图片上传存储形态（继续本地路径 locator）。

## 非目标

- 不修 Shared 锁死 / 续接上下文完整性（独立 change）。
- 不把用户附图投影成 `generatedImage`（那是模型出图）。
- 不改 SubAgent / S10 退役逻辑。
- 不做 git commit。

## 技术方案对比

| 方案 | 描述 | 优点 | 风险 | 结论 |
|------|------|------|------|------|
| A. 仅 FE 合并时把 optimistic.images 抄到无图投影 | 不写 fact | 改动小 | 刷新/重载仍丢图 | **否决为主路径** |
| B. 仅 dispatch 后补写 fact | 晚于 Tx1 | 可能拿到更多元数据 | 违背 durable-first；崩溃窗口丢图 | **否决** |
| **C. Tx1 写入 image_refs + projector/FE 透传 + merge 安全网（推荐）** | 权威与乐观一致 | 双气泡+丢图+重载一并修；全引擎共用 | ArtifactRef 需合法 sha256 | **采用** |

## Capabilities

### New Capabilities

- `shared-user-image-canvas-projection`: Shared 用户附图从 TurnRequested 到幕布用户气泡的端到端投影与 optimistic 收敛合同。

### Modified Capabilities

- `shared-canonical-projection`: `turnRequested` 用户消息 MUST 携带 image locators（当 fact 含 image_refs）。
- `shared-session-curtain-parity`: Shared 用户附图展示与 Native 用户气泡一致（有图则显示，不多气泡）。

## Impact

- Rust: `shared_session_v2` begin_turn / `shared_projection/projector`
- FE: `sharedSessions.ts`, `sendSharedSessionTurnV2.ts`, `sharedProjection/dataSource.ts`, optimistic merge
- Tests: projector / dataSource / begin_turn / merge
- 用户可见：Shared 会话发图不再双气泡、不再丢缩略图

## 验收标准

1. Shared Grok/Claude 等：发「一句话 + 一张图」→ 仅一个用户气泡，含图。
2. 同会话 reload / projection rebuild 后用户气泡仍含图。
3. 模型仍能识图（dispatch images 不回归）。
4. 纯文字 Shared 发送仍单气泡。
5. 相关 unit/integration 测试通过；不提交。
