## 1. Canonical Product Target Catalog

- [x] 1.1 [P0][Depends: none][Input: Product entitlement engines, upstream models, protocol helper][Output: typed per-engine `ProductTargetCatalogV1` with catalog/runtime/provider identity][Verify: focused projection tests cover Codex/Claude/Kimi, incompatible and `id != model`] 建立 canonical Product target projection。
- [x] 1.2 [P0][Depends: 1.1][Input: existing Product picker and target repair][Output: both consumers use projection rows without component-local protocol filtering][Verify: Product picker + target resolver focused tests] 迁移 Composer 与 target repair consumer。

## 2. Kanban Catalog And Persistence

- [x] 2.1 [P0][Depends: 1.1][Input: Product target catalog, local `engineStatuses/codexModels`][Output: explicit Product/Local `KanbanTaskTargetCatalog` adapter][Verify: pure tests cover authority selection, no local leakage, installed semantics and deterministic fallback] 建立 Kanban authority adapter。
- [x] 2.2 [P0][Depends: 2.1][Input: task create/edit modal][Output: selector renders adapter rows and submits exact `ExecutionTarget`][Verify: component tests cover Product 3-engine parity, Kimi/Codex model parity, refresh and edit/draft restore] 接入创建/编辑 UI。
- [x] 2.3 [P1][Depends: 2.2][Input: `KanbanTask`, draft/store loader][Output: optional exact target dual-read/new-write while mirroring flat fields][Verify: storage tests cover good, malformed and legacy payloads] 扩展兼容持久化。

## 3. Exact Task Execution

- [x] 3.1 [P0][Depends: 2.3][Input: task exact/legacy target + current Product snapshot][Output: pre-side-effect resolved target or fail-closed reason][Verify: pure tests cover managed repair, unavailable catalog, local legacy and `id != model`] 建立 task execution target resolver。
- [x] 3.2 [P0][Depends: 3.1][Input: all Kanban launch triggers][Output: engine preparation, provider-scoped session options and runtime model send][Verify: orchestration/helper tests cover autoStart/scheduled/retry/Kimi and no side effect before target ready] 统一 launch boundary。
- [x] 3.3 [P1][Depends: 3.2][Input: TaskRun engine policy and legacy store][Output: selectable executable engines create runs; legacy runs remain readable][Verify: TaskRun storage/coordinator regression tests] 对齐 Task Center engine contract。

## 4. Spec, Quality And Visual Acceptance

- [x] 4.1 [P0][Depends: 3.3][Input: final code facts][Output: Trellis executable contract + foundation ADR calibration with repo-relative sources][Verify: `npm run check:docs`] 同步 code-spec 与 ADR。
- [x] 4.2 [P0][Depends: 4.1][Input: affected frontend/storage/routing surface][Output: L3 focused verification report][Verify: focused Vitest, targeted ESLint, `npm run typecheck`, runtime/contracts, OpenSpec strict validation, `git diff --check`] 完成自动验证。
- [x] 4.3 [P0][Depends: 4.2][Input: Hot Doge Product account][Output: Kanban only shows entitled engines/upstream models and actual task uses selected runtime target][Verify: user visual smoke] 完成目视验收。
