# Tasks: fix-workspace-session-startup-hydration

- [x] **P0 / 依赖：OpenSpec 设计** 增加 gate-ready 后非 active workspace 的单步 idle `first-paint` queue；输出为 hook 调度路径；验证为 strict validation。
- [x] **P0 / 依赖：queue 调度** 保持 collapsed/disconnected/no-active 与现有 cold-start 约束；输出为 bounded background behavior；验证为 hydration Vitest。
- [x] **P1 / 依赖：queue 调度** 补充 sibling 自动 hydration 与 queue 顺序回归测试；输出为 focused test assertions；验证为 Vitest 16/16。
- [x] **P1 / 依赖：实现与测试** 完成 L3 focused verification；输出为 test/typecheck/lint/runtime-contract evidence；验证为 `verification.md`。
- [ ] **P1 / 依赖：人工验收** 在真实 Tauri 桌面双 workspace 冷启动确认无需点击即可出现会话；输出为平台截图/日志；当前保留为 user-authorized manual QA waiver。
