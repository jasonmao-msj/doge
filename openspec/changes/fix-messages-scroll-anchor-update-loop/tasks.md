## 1. Regression Contract

- [x] 1.1 [P0, 无依赖] 在现有 Messages behavior suite 中增加 bottom geometry 与 repeated scroll 输入；输出为 latest anchor 稳定且不产生持续 state commit 的 regression test，并用 focused Vitest 验证。
- [x] 1.2 [P0, 依赖 1.1] 增加 away-from-bottom 输入；输出为 viewport anchor tracking 与既有交互保持不变的 regression assertion，并用 focused Vitest 验证。

## 2. Focused Fix

- [x] 2.1 [P0, 依赖 1.1] 修改 `Messages.scheduleAnchorUpdate` 的 anchor selection；输入为 near-bottom 状态，输出为稳定 latest anchor，且不改变 DOM/CSS/controls。
- [x] 2.2 [P0, 依赖 1.2、2.1] 核对非 bottom 路径继续调用现有 viewport geometry probe；输出为用户手动滚动行为无回归，并通过 focused tests。

## 3. Verification

- [x] 3.1 [P0, 依赖 2.2] 运行 Messages focused Vitest、`npm run typecheck` 与 `openspec validate --all --strict --no-interactive`，输出全部通过的验证结果。
- [x] 3.2 [P1, 依赖 3.1] 审计 git diff，确认无 UI markup/CSS、dependency、backend 或用户现有 Rust 修改扩散，并记录最终影响范围。
