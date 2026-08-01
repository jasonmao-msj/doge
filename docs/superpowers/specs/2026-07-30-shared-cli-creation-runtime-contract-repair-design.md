# Shared CLI Creation And Runtime Contract Repair Design

> **Lifecycle**：implemented，待 OpenSpec flow closure；`repair-shared-cli-creation-runtime-contracts` 为 `7/7`，仍 active。
> **最后校准**：2026-08-01 · mossx `0.7.14` · HEAD `26f8065a0c`

## Outcome

`Shared CLI` 通过二级菜单显式选择本机 ready 的 Claude/Codex/Kimi/Grok/OpenCode；选择后使用该 CLI 的 canonical local Provider 与 runtime-authoritative 默认 Model 立即创建 Shared Session。进入会话后继续使用现有四级 Picker 切换 Provider/Model。

## Root Causes

1. Sidebar Shared 创建回调只传 workspace，AppShell 借用了 `activeEngine` 和当前 Composer Target。
2. OpenCode Picker 使用 `opencode models`，Shared validator 使用 generated fallback，两份 catalog authority 不一致。
3. Kimi/Grok local launch profile 使用裸 workspace key，与 durable Attempt 的 canonical Provider Runtime key 不一致。

## Chosen Design

- 为 menu action 增加通用 `submenuOnly` 语义，仅 Shared parent 使用；不改变 Native Provider parent 点击行为。
- Shared 创建回调显式传递所选 engine，并通过 local initial-target resolver 读取 `get_engine_models` 的 default/first valid entry。
- OpenCode detection/refresh 成功时发布 process-local last-known-good runtime catalog；Shared 同步 validator 优先读取该 snapshot。
- Kimi/Grok local launch profile 调用现有 canonical `*_runtime_key` helper，不放宽 receipt validator。

## Rejected Alternative

创建前展开 CLI → Provider → Model 会复制现有四级 Picker，并制造第二个 Target selection owner；在每个 Shared command 中重新执行 `opencode models` 会把外部 I/O 插入 durable transaction 边界。两者均不采用。

## Verification

- Frontend focused：Sidebar flyout、Shared engine callback、local initial Target。
- Backend focused：OpenCode catalog snapshot、Kimi/Grok local launch profile、Shared receipt identity。
- Gate：targeted typecheck/contract check、OpenSpec strict validation、`git diff --check`。
- 根据用户授权不运行全量测试。
