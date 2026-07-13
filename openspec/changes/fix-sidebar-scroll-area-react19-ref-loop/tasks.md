## 1. Contract And Regression

- [x] 1.1 [P0, 无依赖] 增加 dependency resolution contract；输出为 `radix-ui` scoped ScrollArea fixed-version assertion，并用 focused Vitest 验证。
- [x] 1.2 [P0, 无依赖] 增加真实 ScrollArea + React 19 StrictMode repeated-rerender regression；输出为 DOM/ref continuity 与无 `#185` assertion，并用 focused Vitest 验证。

## 2. Focused Dependency Fix

- [x] 2.1 [P0, 依赖 1.1] 在现有 `overrides.radix-ui` 中 pin `@radix-ui/react-scroll-area@1.2.14`，刷新 lockfile，且不升级整个 `radix-ui`。
- [x] 2.2 [P0, 依赖 2.1] 审计 `npm ls` 与 installed source；输出为 valid scoped tree 和 stable `setScrollArea` composed-ref signature。

## 3. Verification

- [x] 3.1 [P0, 依赖 1.2、2.2] 运行 ScrollArea/Sidebar focused tests 与 AppShell startup tests，输出全部通过且无 React stderr noise。
- [x] 3.2 [P0, 依赖 3.1] 运行 `npm run typecheck`、`npm run lint`、`npm run build` 与 OpenSpec strict validation。
- [x] 3.3 [P0, 依赖 3.2] 反查新 production bundle；输出为 ScrollArea Root stable ref signature、新 asset hash 与边界审计结果。
