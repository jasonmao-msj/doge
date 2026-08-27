# Tasks

## 1. Contract and implementation

- [x] 1.1 Native model wire 接受 API protocol aliases，并输出 validated canonical `api_protocols`。
- [x] 1.2 Renderer DTO 改为 `apiProtocols`，用统一 engine-to-protocol capability 过滤模型。
- [x] 1.3 默认 target、engine switch repair、Picker/search 复用同一 compatibility helper。
- [x] 1.4 更新 foundation ADR 最近校准与 Trellis executable contract。

## 2. Regression and verification

- [x] 2.1 Rust 覆盖 explicit protocol、legacy engine evidence、known fallback 与 unknown fail-closed。
- [x] 2.2 Frontend 覆盖 Codex/Kimi 相同目录、Codex 选择 Kimi model、Claude 双协议投影。
- [x] 2.3 执行 L3 focused verification，记录未运行的 L4 Release/CI 范围。
- [ ] 2.4 提交、记录 Trellis session、push branch 并创建未合并 PR。
