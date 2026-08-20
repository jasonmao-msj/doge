---
name: improve-ut
description: "Analyzes changed files and improves test coverage using current frontend/backend quality guidelines and colocated project test patterns. Determines test scope (unit vs integration vs regression), adds or updates tests, and runs validation. Use when code changes need test coverage, after implementing a feature, after fixing a bug, or when test gaps are identified."
---

# Improve Unit Tests (UT)

Use this skill to improve test coverage after code changes.

## Usage

```text
$improve-ut
```

## Source of Truth

Discover the available package spec layers dynamically:

```bash
# Discover available packages and their spec layers
python3 ./.trellis/scripts/get_context.py --mode packages
```

This repository currently has `frontend`, `backend`, and `guides` layers rather than a dedicated `unit-test/` layer. Read:

- `.trellis/spec/frontend/quality-guidelines.md` for Vitest/frontend changes
- `.trellis/spec/backend/quality-guidelines.md` for Rust/backend changes
- `.trellis/spec/guides/risk-based-test-strategy.md` for L0–L4 validation scope
- existing colocated `*.test.ts`, `*.test.tsx`, and Rust module tests in the touched domain

> If a package later introduces a dedicated test-spec layer, that package-local spec wins.

---

## Execution Flow

1. Inspect changed files:
   - `git diff --name-only`
2. Decide test scope using the applicable quality spec and nearby test patterns:
   - unit vs integration vs regression
   - mock vs real filesystem flow
3. Add/update tests using existing project test patterns
4. Select the risk-based verification level and run only its validation. For the common L1/L2 case:

```bash
npx vitest run <affected-test-files>
npx eslint <changed-ts-tsx-files>
npm run typecheck # L2/L3 or exported type/contract changes
```

`npm run test` is reserved for L4 Release/CI or an explicit user request; do not use it as the default UT completion gate.

5. Summarize decisions, updates, and remaining test gaps.

---

## Output Format

```markdown
## UT Coverage Plan
- Changed areas: ...
- Test scope (unit/integration/regression): ...

## Test Updates
- Added: ...
- Updated: ...

## Validation
- Verification level + rationale: ...
- Focused commands: pass/fail
- L4 not run: ...

## Gaps / Follow-ups
- <none or explicit rationale>
```
