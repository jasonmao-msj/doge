## 1. Backend：DeepSeek balance 路由与数据结构

- [x] 1.1 在 `src-tauri/src/coding_plan_quota.rs` 扩展 `CodingPlanQuotaSnapshot`：新增 `CodingPlanBalanceItem` / `CodingPlanBalanceSnapshot`，字段 camelCase；`balance: Option<...>` additive
  - 验证：结构可 Serialize；既有 windows 供应商编译通过
- [x] 1.2 增加 `CodingPlanProvider::DeepSeek` 与 `detect_provider` 匹配 `api.deepseek.com` / `deepseek.com`（含 `/anthropic`）
  - 验证：单元测试覆盖 deepseek 正例 + 非 deepseek 负例；删除「deepseek is_none」旧断言
- [x] 1.3 实现 `query_deepseek`：`GET https://api.deepseek.com/user/balance` + Bearer；解析 `is_available` / `balance_infos`；映射错误边界（空 key、401、非 2xx、坏 JSON）
  - 验证：`parse_deepseek_balance` 单测（单币种、多币种、空 items）；`query_by_base_url_and_key` 路由到 deepseek
- [x] 1.4 将 DeepSeek 接入 `source_name` / `resolve_quota_route` 成功路径（Codex/Claude third-party 与 generic detect）
  - 验证：`cargo test --manifest-path src-tauri/Cargo.toml coding_plan_quota`

## 2. Frontend 类型与 viewModel

- [x] 2.1 同步 `src/services/tauri/modelCatalog.ts` 中 `CodingPlanQuotaSnapshot` 的 `balance` 类型
  - 验证：类型导出与 hooks 编译无报错
- [x] 2.2 扩展 `CodingPlanQuotaInput` 与 `buildSessionOverviewQuota`：成功条件 = windows 或 balance.items；映射 `hasCredits` / `creditsBalance`
  - 验证：`sessionOverviewViewModel.test.ts` 新增 DeepSeek balance 成功 + Codex rateLimits 不覆盖
- [x] 2.3 Shared multi-entry：`quotaEntries` 中 DeepSeek balance 与 MiniMax windows 分卡
  - 验证：既有 multi quota 测试扩展或新增一条

## 3. UI 边界

- [x] 3.1 `SessionOverviewSection.tsx`：`windows.length===0 && hasCredits` 时跳过 codingPlanEmpty，仅渲染 credits
  - 验证：组件测试或 viewModel+渲染断言；手动清单写入 verification 备注（可选）

## 4. 回归与收口门禁

- [x] 4.1 运行 focused 测试：`cargo test coding_plan_quota` + `pnpm vitest run src/features/status-panel/utils/sessionOverviewViewModel.test.ts`（及相关 SessionOverview 测试）
  - 验证：全绿
- [x] 4.2 确认 Kimi/MiniMax/智谱路径无行为回归（既有 parse/window 单测仍过）
  - 验证：同一 cargo/vitest 套件
- [x] 4.3 OpenSpec：`openspec validate --change fix-deepseek-balance-quota --strict --no-interactive`（实现完成后 verify 再 archive）
  - 验证：本 change 校验通过

## 依赖与优先级

| 顺序 | 任务 | 依赖 | 优先级 |
|------|------|------|--------|
| P0 | 1.1–1.4 后端 | 无 | 阻断前端真值 |
| P0 | 2.1–2.2 类型/viewModel | 1.x 字段契约 | 阻断 UI |
| P1 | 2.3 / 3.1 Shared+UI | 2.2 | 体验边界 |
| P1 | 4.x 回归 | 全部实现 | 收口 |

每个任务预计 ≤2h；1.3 与 2.2 为关键路径。
