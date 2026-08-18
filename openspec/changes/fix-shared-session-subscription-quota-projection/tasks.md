## 1. 调研与定位

- [ ] 1.1 沿 `Shared selectedNextTarget → useSessionQuotaList → getCodingPlanQuota → SessionControlQuotaPane` 画出实际 payload 与状态流
- [ ] 1.2 对照 Account Center quota 数据，确认 Token Matrix authority 的 authoritative endpoint、response fields 与 stable reasons
- [ ] 1.3 判断问题是否仅需 Doge 修改；若必须变更 token2api，先单独列出 upstream contract、兼容策略和生产影响

## 2. Doge 修复（后续实施）

- [ ] 2.1 为 managed Token Matrix quota 增加 target-scoped adapter/view model，不复用不完整的 local provider fallback
- [ ] 2.2 修复 Shared Session quota panel 的 provider、plan、windows/balance、reset time 和 empty/loading/error 投影
- [ ] 2.3 覆盖多 engine、多 provider、单项失败、刷新竞态和 stale response isolation
- [ ] 2.4 保证 Native Session、Account Center、Local Mode 无回归

## 3. 验证与发布

- [ ] 3.1 增加 focused Vitest/Rust contract tests，覆盖 Token Matrix managed quota 的成功和失败状态
- [ ] 3.2 使用测试账号完成 Shared Codex/Claude 真实只读额度 smoke；不执行支付或写操作
- [ ] 3.3 运行 typecheck、lint、focused test、OpenSpec strict validate
- [ ] 3.4 生成本地 macOS/Windows 体验包；确认不影响生产上游服务
