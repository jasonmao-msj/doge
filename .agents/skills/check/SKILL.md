---
name: check
description: "Validates recently written code against project-specific development guidelines from .trellis/spec/. Identifies changed files, selects a risk-based verification level, runs affected checks, and reports guideline violations and untested scope. Use when code is written and needs quality verification, to catch context drift during long sessions, or before committing changes."
---

Check if the code you just wrote follows the development guidelines.

Execute these steps:

1. **Identify changed files**:
   ```bash
   git diff --name-only HEAD
   ```

2. **Determine which spec modules apply** based on the changed file paths:
   ```bash
   python3 ./.trellis/scripts/get_context.py --mode packages
   ```

3. **Read the spec index** for each relevant module:
   ```bash
   cat .trellis/spec/<package>/<layer>/index.md
   ```
   Follow the **"Quality Check"** section in the index.

4. **Read the specific guideline files** referenced in the Quality Check section (e.g., `quality-guidelines.md`, `conventions.md`). The index is NOT the goal — it points you to the actual guideline files. Read those files and review your code against them.

5. **Read `.trellis/spec/guides/risk-based-test-strategy.md`**, classify the change as L0–L4, and state the trigger and impact surface.

6. **Run only the checks required by that level**:
   - L0: docs/spec/schema validation as applicable.
   - L1: changed/nearest focused tests + targeted lint.
   - L2: affected feature suites + typecheck + targeted lint/contracts.
   - L3: affected cross-layer tests/contracts + compile checks; full suites only if scope cannot be bounded.
   - L4: Release/CI full gates.

7. **Report** verification level, rationale, commands, results, untested L4 scope, and any violations. Fix violations within the selected impact surface.
