## 1. Planning

- [x] 1.1 收集 v0.1.13 local rollout、Codex logs、durable target 与 token2api request-id evidence。 [P0]
- [x] 1.2 建立 proposal、design、spec deltas 与 Trellis task。 [P0]

## 2. Backend managed configuration

- [x] 2.1 引入 Codex Product-safe default constant，更新 `model/review_model` 为 `gpt-5.6-sol`。 [P0]
- [x] 2.2 bump managed configuration revision，覆盖 revision-2 existing install migration。 [P0]
- [x] 2.3 保持 Kimi `gpt-5.5` 独立默认与 local/custom provider isolation。 [P0]

## 3. Frontend target freeze

- [x] 3.1 Native Product session 优先使用 canonical `nativeProductTarget`，unresolved 时禁发。 [P0]
- [x] 3.2 managed Native send options 冻结完整 `MessageExecutionTargetSnapshot`。 [P0]
- [x] 3.3 messaging boundary 优先消费 explicit snapshot，不被 async cache/default 覆盖。 [P0]

## 4. Verification and closure

- [x] 4.1 添加 Rust revision/default regression。 [P0]
- [x] 4.2 添加 Composer + messaging immediate-first-send regressions。 [P0]
- [x] 4.3 完成 L3 gates、Hot Doge smoke、spec/code-spec sync 与 archive。 [P0]

## 5. Shared generated-image durability

- [x] 5.1 在 Shared terminal commit 从 exact provider/native session/runtime turn rollout reconcile completed image，并 bounded/atomic materialize 为 local artifact。 [P0]
- [x] 5.2 把 compact `ArtifactRef` 纳入 canonical `turnCommitted`，Projection 复用 generated-image renderer 并对齐 live id。 [P0]
- [x] 5.3 添加 invalid/oversized/idempotent persistence 与 Shared projection regressions。 [P0]
- [x] 5.4 Shared V2 committed boundary 触发 canonical projection refresh，失败不回滚 durable success。 [P0]
- [x] 5.5 精确 allowlist managed generated-image root，并与 renderer payload bound 对齐。 [P0]
- [x] 5.6 Hot Doge 验证 Shared live、refresh/restart 都显示真实图片。 [P0]
