## 1. Regression Coverage

- [x] 1.1 [P0, depends: none] Add a StrictMode hook regression covering settings readiness plus pending-to-canonical migration; input is persisted/default selection fixtures, output is bounded renders with continuous canonical selection; verify with focused Vitest.
- [x] 1.2 [P1, depends: none] Extend React Scan controller tests to assert public `scan()` enablement without internal signal mutation; verify with focused Vitest.

## 2. Startup Convergence Fix

- [x] 2.1 [P0, depends: 1.1] Introduce a synchronized composer-selection cache snapshot and route logical cache mutations through equality-gated helpers; output removes reload's dependency on the state it writes; verify with hook tests.
- [x] 2.2 [P0, depends: 2.1] Order pending-to-canonical migration before active selection reload and preserve selection continuity; verify canonical resolver and storage write assertions.
- [x] 2.3 [P1, depends: 1.2] Remove direct React Scan instrumentation signal assignment while retaining persisted option recovery and public enable/disable behavior; verify controller tests.

## 3. Quality Gate

- [x] 3.1 [P0, depends: 2.2, 2.3] Run focused composer/React Scan/AppShell startup tests and record exact results.
- [x] 3.2 [P0, depends: 3.1] Run lint, typecheck, production build, `git diff --check`, and relevant runtime/large-file gates.
- [x] 3.3 [P0, depends: 3.2] Run strict OpenSpec validation, complete task/verification evidence, and review the final diff without launching any desktop App.
