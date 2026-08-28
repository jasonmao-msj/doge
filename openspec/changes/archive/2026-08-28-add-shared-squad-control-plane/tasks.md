## 1. Domain And Canonical Contracts

- [x] 1.1 [P0, deps: none] 输入 approved design/specs；新增 `squad_orchestration` domain types 与 serde wire contract；输出 versioned run/plan/node/attempt/outcome DTO；验证 Rust serde round-trip tests。
- [x] 1.2 [P0, deps: 1.1] 输入 typed domain DTO；扩展 `CanonicalFact`、fact type/id/time mapping 与 validator；输出 12 类 Squad facts；验证 valid/invalid/duplicate focused tests。
- [x] 1.3 [P0, deps: 1.2] 输入 new facts；接入 `SharedEventWriter` single-writer append/read path 与 additive migration；输出旧库兼容的 durable facts；验证 storage migration/idempotency tests。

## 2. Plan Authority And Projection

- [x] 2.1 [P0, deps: 1.1] 输入 `SquadPlanProposalV1`；实现 pure plan validator（DAG、identity、budget、target、permission、final node）；输出 stable validation diagnostics；验证 cycle/allowlist/verifier/budget tests。
- [x] 2.2 [P0, deps: 1.2,2.1] 输入 canonical Squad facts；实现 deterministic `SquadProjectionV1` 与 one-active-run admission；输出 incremental/full replay parity；验证 checkpoint deletion、duplicate、session isolation tests。
- [x] 2.3 [P1, deps: 2.2] 输入 durable Worker owner metadata；让 Shared Conversation projection隐藏全部 Worker turns，并仅从 successful settlement投影一次 final answer；输出 nested presentation boundary；验证 incremental rebuild/no-flash/top-level-final tests。

## 3. Commands And Frontend Contract

- [x] 3.1 [P0, deps: 1.3,2.2] 输入 request/revise/approve/get/cancel DTO；实现 core functions、Tauri thin commands 与 `command_registry.rs` registration；输出 deterministic error paths；验证 Rust command tests。
- [x] 3.2 [P1, deps: 3.1] 输入 Rust camelCase responses；新增 `src/services/tauri/squadOrchestration.ts` mapping 与 runtime guards；输出 frontend single service boundary；验证 payload mapping/unknown-field tests。

## 4. Gates

- [x] 4.1 [P0, deps: 1.1-3.2] 输入实现与 specs；运行 focused Rust tests、`cargo check`、`npm run typecheck`、runtime contracts 与 strict OpenSpec validation；输出零新增失败或明确 baseline 归因。
- [x] 4.2 [P1, deps: 4.1] 输入实际代码事实；同步 foundation ADR 最近校准、Phase 5 checklist 与 manual test matrix；输出 repo-relative evidence links；验证 docs/ADR gate。
