# Proposal: Restore Managed Session Target After Cold Start

## Why

重启后 Native session 的模型选择不能依赖 renderer 的 `selectedModelByThread.*` cache。
当前 durable session metadata 只记录 provider binding，未记录 `modelCatalogEntryId`、runtime
model 与 reasoning effort；canonical thread id 变化、cache 尚未加载或 store 写入尚未完成时，
会话会退回默认模型，导致用户之前使用的 `k3-256k` 被恢复成其他模型，重新选择也可能因为
catalog 尚未收敛而无法提交。

同时，managed toolchain binary 只保存在 Rust 进程内存。重启后 persisted engine restore 会
误走普通 `switch_engine("codex")`，而 managed Codex 并不是 native disk-installed Codex，
最终把可恢复的 managed runtime 误报为未安装。

真实 restart smoke 进一步暴露了 Shared Session 的独立 cold-start race：Shared history 尚未
hydrate `selectedNextTarget` 时，Product catalog 会把空 target 解析成首个 global/default
model，Composer 的 automatic repair effect 随即把该默认值写入 legacy `meta.json` 与
`shared_sessions_v2.selected_target_json`。该写入还会推进 persist generation，使稍后返回的
真实历史 target 被 stale guard 丢弃，最终把用户的 `Kimi / k3-256k` durable selection
覆盖为 `Codex / gpt-5.6-sol`。

## What Changes

- 扩展已有 session engine provider binding 的 durable record，保存并返回完整 execution target：
  `providerProfileId`、`modelCatalogEntryId`、runtime `model` 与 `reasoningEffort`。
- session catalog hydration 优先使用 durable execution target；renderer client store 只作
  cache/fallback，并兼容迁移旧 `selectedModelByThread.*` 数据。
- 用户明确提交 model/effort selection 时走立即 durable write，避免 debounce 或窗口关闭丢失。
- managed engine restore 先 resolve/verify managed toolchain；managed provider 使用
  `account_engine_v1_activate`，普通 disk provider 才使用 generic `switch_engine`。
- managed binary 在进程内缓存为空时支持从当前 bundled/external toolchain 重新 resolve，
  并在 activation 前再次验证；失败必须 fail closed 且返回结构化 stage/code。
- Shared cold start 读取按 `Shared V2 durable target > legacy meta` 投影；read path 不写回。
- Shared target 未 hydrate 时禁止 automatic catalog repair 持久化 global/default model；仅对
  已存在且完整的 durable target 做 identity migration/repair。

## Scope

- `src-tauri/src/session_management*`、account runtime/toolchain activation。
- `src/services/tauri/sessionManagement.ts` 与 engine/session catalog DTO。
- `useSelectedComposerSession`、Shared history/Composer、layout props、engine restore 与相关
  focused tests。

不改变 `k3-256k` 的 catalog identity 与 `k3` runtime identity，不改 provider pricing、
上游 model catalog 或 native continuation context protocol。

## Verification

本 change 为 **L3 Cross-layer / High-risk**：触及 React hydration、durable session metadata、
Tauri IPC、Rust startup/engine routing 与 managed runtime recovery。执行 affected Vitest、
targeted ESLint、TypeScript typecheck、runtime contract check、Rust focused tests 与
`cargo check --lib`；不默认执行 L4 全量 suite、packaged platform smoke。
