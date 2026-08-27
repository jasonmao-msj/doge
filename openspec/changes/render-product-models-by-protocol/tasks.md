# Tasks

## 1. Contract and implementation

- [x] 1.1 Native model wire 接受 API protocol aliases，并输出 validated canonical `api_protocols`。
- [x] 1.2 Renderer DTO 改为 `apiProtocols`，用统一 engine-to-protocol capability 过滤模型。
- [x] 1.3 默认 target、engine switch repair、Picker/search 复用同一 compatibility helper。
- [x] 1.4 更新 foundation ADR 最近校准与 Trellis executable contract。

## 2. Regression and verification

- [x] 2.1 Rust 覆盖 explicit protocol、legacy engine evidence、known fallback 与 unknown fail-closed。
- [x] 2.2 Frontend 覆盖初版 broad OpenAI projection（已被 §3 runtime evidence 纠正）。
- [x] 2.3 执行 L3 focused verification，记录未运行的 L4 Release/CI 范围。
- [x] 2.4 提交、记录 Trellis session、push branch 并更新未合并 PR #35。

## 3. Runtime evidence correction

- [x] 3.1 记录 Codex+K3 rollout 与 Responses/Chat Completions 最小 probe evidence。
- [x] 3.2 将 canonical protocol 拆为 Responses、Chat Completions、Anthropic Messages。
- [x] 3.3 定位 Responses 400 为 production Composite route 缺口，而非 Kimi converter 缺失。
- [x] 3.4 经用户授权在 production UI 新增 `kimi*` / `k3*` → Kimi / Responses routes，并复测
  `k3`、`k3-256k`、`kimi-for-coding` Responses 全部 HTTP 200。
- [x] 3.5 K3/Kimi fallback 投影到 Codex + Kimi，补 Rust/Frontend regression 并更新 Trellis/ADR。
- [x] 3.6 用 Doge isolated Codex provider home + managed key + `model=k3` 完成真实 CLI turn：
  exit 0，final message `OK`。
- [x] 3.7 更新 PR #35 并完成用户 hot UI 复验。

## 4. Release handoff

- [x] 4.1 用户确认 Hot Doge 目视验收通过；release candidate 升级为 `v0.1.2`。
- [ ] 4.2 合并 PR #35，显式以 `windows_artifact_only=false`、`macos_artifact_only=false`
  触发 signed release workflow，并核验 GitHub Release、updater manifest 与平台产物。
