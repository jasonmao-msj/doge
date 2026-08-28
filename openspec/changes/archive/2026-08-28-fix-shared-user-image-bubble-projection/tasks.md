## 1. Durable fact + projection (Rust)

- [x] 1.1 `begin_turn_core` / `shared_session_v2_begin_turn` 接受可选 `images`，写入 `TurnRequested.input.image_refs`
- [x] 1.2 本地 path → 合法 `ArtifactRef`（locator + mediaType + sha256）
- [x] 1.3 `project_turn_requested` 输出 `content.images: string[]`
- [x] 1.4 编译通过；既有 shared_session_v2 单测可运行（3 个失败属并行 WIP resume-integrity，非本 change）

## 2. FE transport + dataSource

- [x] 2.1 `sharedSessionV2BeginTurn` / `sendSharedSessionTurnV2` 把 `images` 传入 Tx1
- [x] 2.2 `sharedProjection/dataSource` message 分支映射 `images`
- [x] 2.3 dataSource 单测覆盖 user images

## 3. Optimistic merge 安全网

- [x] 3.1 text 等价时有图/无图收敛为单条并保留 images
- [x] 3.2 合并相关 Vitest

## 4. 验证与换视角 review

- [x] 4.1 跑相关 Vitest（58 passed）+ cargo check
- [x] 4.2 换视角 review（见下方 review 笔记）并修 merge text 收敛
- [x] 4.3 **不提交**

## 5. 历史路径补洞（用户反馈：实时有图、history 丢图）

- [x] 5.1 `CANVAS_PROJECTION_VERSION` → 9，强制 rebuild 含 user images 的 projection
- [x] 5.2 `mergeHistoryProjectionItems` text 等价匹配 + 保留更完整 images
- [x] 5.3 `upsertSnapshotItem` 用户消息合并保图
- [x] 5.4 Vitest：legacy/projection 一侧有图时合并后仍有图
