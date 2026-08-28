## 1. Implementation

- [x] 1.1 [P0, depends: none] 输入 `Composer` rewind local state 与 capability；输出 stable pre-dispatch reset callback，并让 thread/capability effects 依赖 semantic primitive；验证 source review 与 TypeScript compile。
- [x] 1.2 [P0, depends: 1.1] 输入现有 rewind confirm harness；输出 thread transition、capability 与 callback identity regression coverage；验证 focused Vitest 在 React StrictMode 下通过。

## 2. Contract and Knowledge

- [x] 2.1 [P1, depends: 1.1] 输入 change delta spec；输出同步后的 `client-renderer-stability-under-pressure` main spec；验证 requirement/scenario 可由 regression test 对应。
- [x] 2.2 [P1, depends: 1.1] 输入 production report 与 bundle/source mapping；输出 React #185 playbook case `C-20260804-03`；验证包含 Trigger、Root cause、Fix、Verification 与 Guardrail。

## 3. Verification and Delivery

- [x] 3.1 [P0, depends: 1.2] 输入全部 touched frontend files；输出 focused Vitest、`npm run typecheck`、`npm run lint` 结果；验证命令 exit code 为 0。
- [x] 3.2 [P0, depends: 2.1, 2.2, 3.1] 输入 change artifacts 与 implementation；输出 strict OpenSpec validation、code review 与 break-loop 结论；验证无 unresolved finding/spec drift。
- [x] 3.3 [P1, depends: 3.2] 输入已验证 diff；输出中文 Conventional Commit 与 Trellis session record；验证 commit 后 working tree 仅保留用户原有未提交改动。
