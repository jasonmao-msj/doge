## Verification Summary

Status: implementation gates passed; desktop manual acceptance deferred to the user by request.

## Root-Cause Evidence

- Minified stack maps the failing component to `AppShell`.
- The pre-fix StrictMode regression observed a finalize render sequence containing `null` after a valid pending selection.
- The pre-fix React Scan controller test proved that enabling diagnostics directly mutated `ReactScanInternals.instrumentation.isPaused.value`.
- After the fix, composer reload no longer depends on the cache state it writes, migration runs before reload in layout phase, and React Scan mutation uses public `scan()` only.

## Automated Evidence

- `npm exec vitest run src/app-shell.startup.test.tsx src/app-shell-parts/useSelectedComposerSession.test.tsx src/services/reactScanController.test.ts src/components/ui/scroll-area.test.tsx src/features/app/components/ThreadList.test.tsx src/features/app/components/PinnedThreadList.test.tsx`
  - PASS: 6 files, 59 tests.
- Final focused rerun:
  - PASS: 3 files, 23 tests.
- `npm run lint`
  - PASS.
- `npm run typecheck`
  - PASS.
- `npm run build`
  - PASS; existing Vite chunk-size and mixed static/dynamic import warnings remain.
- `npm run check:runtime-contracts`
  - PASS.
- `npm run check:large-files`
  - Command PASS in report mode; it reports four pre-existing oversized files unrelated to this change.
- `git diff --check`
  - PASS.
- `openspec validate fix-app-shell-composer-startup-convergence --strict --no-interactive`
  - PASS.

## Full-Suite Residual

`npm test` reached the existing `src/features/app/components/Sidebar.test.tsx` batch and stopped on three unrelated stale assertions:

- runtime notice bottom-action count expects `4`, rendered `2`;
- two Codex provider menu tests query `menuitem`, while the rendered provider option is `menuitemradio` with updated accessible text.

The same three failures existed before this change. No Sidebar source or test was modified by this change.

## Manual Boundary

- No desktop App was launched or operated during verification.
- User should validate a rebuilt current app with persisted diagnostics/settings state and repeated cold starts.
