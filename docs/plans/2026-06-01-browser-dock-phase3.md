# Browser Dock Phase 3 Implementation Plan

> **Lifecycle**：Implemented / Historical Plan。对应 trusted observation / code bridge change 已归档于 `openspec/changes/archive/2026-06-03-advance-browser-dock-trusted-observation-and-code-bridge/`；跨平台实机 evidence 仍须重跑。
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Browser Dock Phase 3 as a trusted observation and code-bridge substrate before enabling higher-risk browser automation.

中文目标：Phase 3 先把 Browser Dock 做成“可信观察层 + 证据审查层 + 用户标注契约 + 本地代码候选桥”，暂时不急着做高风险 browser automation。

**Architecture:** Preserve the existing Browser Dock single-renderer and active-tab baseline. Add a BrowserObservation trust envelope, sectioned Browser Evidence view model, structured user annotations, workspace-aware code candidates, and preview-first action contracts without expanding BrowserDock or Composer responsibilities.

中文架构理解：`BrowserDock` 只管 session/tab/renderer lifecycle；`BrowserObservation` 判断 capture 是否可信；`Evidence Inspector` 负责展示证据；`BrowserUserAnnotation` 把用户标注变成 structured text evidence；`Code Bridge` 给代码候选；`Action Preview` 只做 preview/confirm/audit。

**Tech Stack:** React + TypeScript + Vitest for frontend, Tauri 2 + Rust for backend commands/DTOs, OpenSpec for behavior contracts, Trellis for implementation workflow.

---

## Source Contract

OpenSpec change:

```text
advance-browser-dock-trusted-observation-and-code-bridge
```

Primary artifacts:

```text
openspec/changes/advance-browser-dock-trusted-observation-and-code-bridge/proposal.md
openspec/changes/advance-browser-dock-trusted-observation-and-code-bridge/design.md
openspec/changes/advance-browser-dock-trusted-observation-and-code-bridge/tasks.md
openspec/changes/advance-browser-dock-trusted-observation-and-code-bridge/specs/browser-agent-page-understanding/spec.md
```

First Trellis execution task:

```text
.trellis/tasks/06-01-browser-dock-phase3-observation-core/prd.md
```

Validated command already passed:

```bash
openspec validate advance-browser-dock-trusted-observation-and-code-bridge --strict --no-interactive
```

Expected result:

```text
Change 'advance-browser-dock-trusted-observation-and-code-bridge' is valid
```

---

## Implementation Batches

| Batch | Scope | Goal | Risk |
|---|---|---|---|
| Batch 1 | Observation + stale reasons | 建立可信 observation contract，明确 stale/degraded/expired | Medium |
| Batch 2 | Canonical capture script | 统一 frontend/Rust extraction，避免 capture drift | Medium-high |
| Batch 3 | Evidence Inspector | Composer 和 message evidence views 使用同一 view model | Medium |
| Batch 4 | User Annotation contract | 用户可标注 page point/region/element/text，AI 看到 structured evidence | Medium |
| Batch 5 | Code Bridge v2 core | 改进 workspace-local code candidates | Medium |
| Batch 6 | Action Preview contract | 定义 gate/preview/audit，不执行 mutating actions | Medium |
| Batch 7 | Visual Evidence scaffold | 增加 opt-in gate；OCR/annotated screenshots 先 defer | High |

Recommended first implementation task: Batch 1 + the minimum UI integration from Batch 3.

Do not start with OCR, screenshot capture, external provider fallback, or browser action execution.

---

## First Trellis Task Recommendation

Task name:

```text
Implement Browser Dock trusted observation core
```

Trellis task:

```text
06-01-browser-dock-phase3-observation-core
```

Linked OpenSpec change:

```text
advance-browser-dock-trusted-observation-and-code-bridge
```

Suggested OpenSpec tasks for the first implementation slice:

```text
1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 3.3, 7.1, 7.2, 8.1, 8.2, 8.3
```

Explicitly out of scope for first slice:

```text
2.1-2.4 canonical capture script
4.x full code bridge scoring
5.x visual evidence
6.3+ safe action execution
annotated screenshot / image overlay / vision payload
```

Rationale: establish observation + UI contract first. Capture transport and action runtime should not be changed in the same slice.

---

## Required Project Context Before Coding

Before touching code, read the specific project guidelines required by `AGENTS.md` and Trellis indexes:

```bash
cat AGENTS.md
cat .trellis/spec/frontend/index.md
cat .trellis/spec/backend/index.md
cat .trellis/spec/guides/index.md
cat .trellis/spec/frontend/directory-structure.md
cat .trellis/spec/frontend/component-guidelines.md
cat .trellis/spec/frontend/hook-guidelines.md
cat .trellis/spec/frontend/quality-guidelines.md
cat .trellis/spec/frontend/type-safety.md
cat .trellis/spec/backend/directory-structure.md
cat .trellis/spec/backend/error-handling.md
cat .trellis/spec/backend/quality-guidelines.md
cat .trellis/spec/guides/cross-layer-thinking-guide.md
cat .trellis/spec/guides/code-reuse-thinking-guide.md
```

---

## Batch 1: Observation Contract And Stale Policy

### Task 1: Add BrowserObservation frontend types

**Files:**

- Modify: `src/features/browser-agent/types.ts`
- Modify: `src/features/browser-agent/constants.ts`
- Test: `src/features/browser-agent/utils/attachment.test.ts`

**Step 1: Write failing formatter test**

Add a test asserting that a built attachment includes observation state and stale reasons.

```ts
it("includes trusted observation state in browser context attachments", () => {
  const attachment = buildBrowserContextAttachment(makeSnapshot(), {
    now: 1100,
    staleAfterMs: 5000,
  });

  expect(attachment.observation).toMatchObject({
    schemaVersion: 1,
    state: "available",
    staleReasons: [],
    rendererBinding: "matched",
  });
});
```

**Step 2: Run focused test and verify failure**

```bash
npx vitest run src/features/browser-agent/utils/attachment.test.ts
```

Expected: FAIL because `observation` does not exist yet.

**Step 3: Add frontend types**

Add types similar to:

```ts
export type BrowserObservationState =
  | "available"
  | "degraded"
  | "stale"
  | "expired"
  | "unsupported";

export type BrowserObservationStaleReason =
  | "active_tab_changed"
  | "renderer_mismatch"
  | "url_changed"
  | "title_changed"
  | "scroll_changed"
  | "dom_fingerprint_changed"
  | "ttl_expired"
  | "browser_dock_closed"
  | "session_closed"
  | "workspace_mismatch"
  | "capture_degraded";

export type BrowserObservationTransport =
  | "webview_dom"
  | "metadata_fallback"
  | "unavailable";

export type BrowserObservationRendererBinding =
  | "matched"
  | "mismatched"
  | "unavailable";

export type BrowserObservation = {
  schemaVersion: 1;
  observationId: string;
  browserSessionId: string;
  workspaceId: string;
  capturedAt: number;
  state: BrowserObservationState;
  staleReasons: BrowserObservationStaleReason[];
  transport: BrowserObservationTransport;
  rendererBinding: BrowserObservationRendererBinding;
};
```

Important: do not add `screenshot_ocr` or `external_provider` to default implementation yet. They are future/opt-in paths in OpenSpec.

**Step 4: Add observation field to BrowserContextAttachment**

Add:

```ts
observation: BrowserObservation;
```

**Step 5: Implement minimal builder logic**

In `buildBrowserContextAttachment`, derive:

```ts
const observationState = stale
  ? freshness === "expired"
    ? "expired"
    : "stale"
  : snapshot.availability === "available"
    ? "available"
    : "degraded";
```

Start conservative:

```ts
observation: {
  schemaVersion: 1,
  observationId: `browser-observation-${snapshot.snapshotId}`,
  browserSessionId: snapshot.browserSessionId,
  workspaceId: snapshot.workspaceId,
  capturedAt: snapshot.capturedAt,
  state: observationState,
  staleReasons: stale ? [freshness === "expired" ? "ttl_expired" : "capture_degraded"] : [],
  transport: snapshot.availability === "available" ? "webview_dom" : "metadata_fallback",
  rendererBinding: snapshot.freshness === "stale" ? "mismatched" : "matched",
}
```

Refine in later stale reconciliation task.

**Step 6: Run test**

```bash
npx vitest run src/features/browser-agent/utils/attachment.test.ts
```

Expected: PASS.

---

### Task 2: Round-trip observation through formatter/parser

**Files:**

- Modify: `src/features/browser-agent/utils/attachment.ts`
- Test: `src/features/browser-agent/utils/attachment.test.ts`

**Step 1: Write failing round-trip test**

```ts
it("round-trips observation state through the browser context prompt", () => {
  const attachment = buildBrowserContextAttachment(makeSnapshot(), { now: 1100 });
  const prompt = formatBrowserContextPrompt(attachment);
  const parsed = parseBrowserContextPrompt(`${prompt}\n\nUser request`);

  expect(prompt).toContain("observation.state: available");
  expect(prompt).toContain("observation.schemaVersion: 1");
  expect(parsed?.observation?.state).toBe("available");
});
```

**Step 2: Run test and verify failure**

```bash
npx vitest run src/features/browser-agent/utils/attachment.test.ts
```

Expected: FAIL because formatter/parser do not include observation fields.

**Step 3: Extend formatter**

Add lines to `<browser_context_v2>`:

```text
observation.schemaVersion: 1
observation.state: available
observation.staleReasons: none
observation.transport: webview_dom
observation.rendererBinding: matched
```

**Step 4: Extend parser**

Parse observation lines into partial `BrowserContextAttachment` compatible data.

**Step 5: Run test**

```bash
npx vitest run src/features/browser-agent/utils/attachment.test.ts
```

Expected: PASS.

---

### Task 3: Reconcile stale reasons in attachment hook

**Files:**

- Modify: `src/features/browser-agent/hooks/useBrowserContextAttachment.ts`
- Test: create or extend `src/features/browser-agent/hooks/useBrowserContextAttachment.test.tsx` if test utilities already exist; otherwise cover logic through extracted utility test.

**Step 1: Extract pure utility**

Create a pure helper, preferably in:

```text
src/features/browser-agent/observation/browserObservation.ts
```

Function shape:

```ts
export function reconcileBrowserObservation(
  attachment: BrowserContextAttachment,
  activeContext: ActiveBrowserContextState | null,
  now = Date.now(),
): BrowserContextAttachment
```

**Step 2: Test each stale reason**

Cover at least:

- active session mismatch -> `active_tab_changed`
- URL mismatch -> `url_changed`
- renderer not bound -> `renderer_mismatch`
- TTL exceeded -> `ttl_expired`
- workspace mismatch -> `workspace_mismatch`

**Step 3: Replace inline stale logic**

Update `reconcileAttachmentFreshness` to call the pure helper.

**Step 4: Run focused tests**

```bash
npx vitest run src/features/browser-agent/utils/attachment.test.ts src/features/browser-agent/observation/browserObservation.test.ts
```

Expected: PASS.

---

### Task 4: Add Rust DTO mirror

**Files:**

- Modify: `src-tauri/src/browser_agent/types.rs`
- Modify: `src-tauri/src/browser_agent/mod.rs`

**Step 1: Add Rust enums/struct**

Add camelCase serializable types equivalent to frontend types.

**Step 2: Add observation to snapshot or response path**

Prefer not to mutate too much of backend storage in first pass. If snapshot is the backend source, add a bounded observation field to `BrowserContextSnapshot` or map it in frontend from existing backend fields.

Recommendation for first pass: map in frontend unless backend already needs observation diagnostics.

**Step 3: Add Rust serialization test**

In browser_agent tests, assert camelCase JSON contains:

```json
{
  "schemaVersion": 1,
  "rendererBinding": "matched"
}
```

**Step 4: Run Rust focused tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml browser_agent
```

Expected: PASS.

---

## Batch 3: Evidence Inspector Minimum Slice

### Task 5: Build evidence view model

**Files:**

- Create: `src/features/browser-agent/evidence/browserEvidenceViewModel.ts`
- Test: `src/features/browser-agent/evidence/browserEvidenceViewModel.test.ts`

**Step 1: Write view-model test**

```ts
it("builds sectioned browser evidence from an attachment", () => {
  const viewModel = buildBrowserEvidenceViewModel(makeAttachment());

  expect(viewModel.sections.map((section) => section.id)).toEqual([
    "overview",
    "primaryContent",
    "readableBlocks",
    "interactiveElements",
    "visualEvidence",
    "codeCandidates",
    "diagnostics",
    "privacyBudget",
  ]);
});
```

**Step 2: Implement minimal view model**

Use existing attachment fields:

- summary
- primaryContent
- readableBlocks
- visualEvidence
- codeCandidates
- diagnostics
- privacy
- budget
- observation

**Step 3: Run test**

```bash
npx vitest run src/features/browser-agent/evidence/browserEvidenceViewModel.test.ts
```

Expected: PASS.

---

### Task 6: Add BrowserEvidenceInspector component

**Files:**

- Create: `src/features/browser-agent/components/BrowserEvidenceInspector.tsx`
- Create: `src/features/browser-agent/components/BrowserEvidenceSection.tsx`
- Test: `src/features/browser-agent/components/BrowserEvidenceInspector.test.tsx`

**Step 1: Component test**

Assert:

- compact overview renders
- stale/degraded badge renders
- section expand works
- privacy/budget section does not show raw forbidden content

**Step 2: Implement component**

Keep component dumb. It receives view model, not raw snapshot.

**Step 3: Run component test**

```bash
npx vitest run src/features/browser-agent/components/BrowserEvidenceInspector.test.tsx
```

Expected: PASS.

---

### Task 7: Wire preview and summary card to Evidence Inspector

**Files:**

- Modify: `src/features/browser-agent/components/BrowserContextPreview.tsx`
- Modify: `src/features/browser-agent/components/BrowserContextSummaryCard.tsx`
- Test: `src/features/browser-agent/components/BrowserContextPreview.test.tsx`
- Test: `src/features/browser-agent/components/BrowserContextSummaryCard.test.tsx`

**Step 1: Update existing tests**

Assert observation state appears in both preview and summary card.

**Step 2: Replace duplicate section rendering**

Use `buildBrowserEvidenceViewModel` and `BrowserEvidenceInspector` in both surfaces.

**Step 3: Run focused tests**

```bash
npx vitest run src/features/browser-agent/components/BrowserContextPreview.test.tsx src/features/browser-agent/components/BrowserContextSummaryCard.test.tsx
```

Expected: PASS.

---

## Batch 4: Code Bridge v2 Core

### Task 8: Define user annotation contract

中文目标：先定义 `BrowserUserAnnotation` 的数据契约和 stale policy，让“用户圈这里/点这里/选这段文本”能被 AI 作为 structured text evidence 理解。此任务不做 annotated screenshot，也不做 vision model injection。

**Files:**

- Create: `src/features/browser-agent/annotations/browserUserAnnotationTypes.ts`
- Create: `src/features/browser-agent/annotations/browserUserAnnotation.ts`
- Test: `src/features/browser-agent/annotations/browserUserAnnotation.test.ts`
- Modify: `src/features/browser-agent/evidence/browserEvidenceViewModel.ts`

**Step 1: Add annotation types**

Define:

```ts
export type BrowserAnnotationAnchorType =
  | "point"
  | "region"
  | "element"
  | "text_range";

export type BrowserUserAnnotation = {
  annotationId: string;
  observationId: string;
  browserSessionId: string;
  workspaceId: string;
  createdAt: number;
  url: string;
  title?: string;
  anchorType: BrowserAnnotationAnchorType;
  userNote: string;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
    devicePixelRatio: number;
  };
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  nearbyText?: string;
  nearestElement?: {
    role?: string;
    label?: string;
    placeholder?: string;
    hrefOrigin?: string;
    selectorHint?: string;
    sensitive?: boolean;
  };
  staleReasons: BrowserObservationStaleReason[];
};
```

**Step 2: Add stale reconciliation helper**

Use the same observation stale policy for annotation freshness. A coordinate-only annotation becomes stale when URL/title/scroll/session/workspace/TTL/renderer no longer match.

**Step 3: Attach annotations to evidence view model**

Add an optional `annotations` section to the Browser Evidence view model. Default AI payload is structured text evidence:

```text
User annotation:
- note
- anchor type
- viewport and region metadata
- nearby text
- nearest element metadata
- stale reasons
```

**Step 4: Keep visual payload blocked**

Do not send annotated screenshots, overlay images, or multimodal region payloads in this task.

**Step 5: Run focused tests**

```bash
npx vitest run src/features/browser-agent/annotations/browserUserAnnotation.test.ts src/features/browser-agent/evidence/browserEvidenceViewModel.test.ts
```

Expected: PASS.

---

## Batch 5: Code Bridge v2 Core

### Task 9: Define candidate v2 contract

**Files:**

- Create: `src/features/browser-agent/code-bridge/browserCodeCandidateTypes.ts`
- Modify: `src/features/browser-agent/utils/codeCandidates.ts`
- Test: `src/features/browser-agent/utils/codeCandidates.test.ts`

**Step 1: Add tests**

Cover:

- external URL returns empty candidates
- localhost route creates route candidates
- low confidence wording guard exists

**Step 2: Add v2 fields**

Candidate fields:

```ts
sourceEvidence
explanation
openAction
```

**Step 3: Run tests**

```bash
npx vitest run src/features/browser-agent/utils/codeCandidates.test.ts
```

Expected: PASS.

---

### Task 10: Add candidate scorer

**Files:**

- Create: `src/features/browser-agent/code-bridge/browserCodeCandidateScorer.ts`
- Test: `src/features/browser-agent/code-bridge/browserCodeCandidateScorer.test.ts`

**Step 1: Test scoring rules**

- route + file exact -> medium/high depending evidence
- visible text only -> low
- button/form landmark only -> low
- multiple evidence types -> higher confidence

**Step 2: Implement scorer**

Keep scoring simple and explainable. No ML, no fuzzy magic beyond normalized string matching.

**Step 3: Run tests**

```bash
npx vitest run src/features/browser-agent/code-bridge/browserCodeCandidateScorer.test.ts
```

Expected: PASS.

---

## Batch 6: Action Preview Contract Only

### Task 11: Add action gate resolver

**Files:**

- Modify: `src/features/browser-agent/types.ts`
- Modify: `src-tauri/src/browser_agent/types.rs`
- Modify: `src-tauri/src/browser_agent/mod.rs`
- Test: Rust browser_agent tests

**Step 1: Add tests**

Assert:

- navigate/reload/scroll can be previewable only if settings/platform allow
- click/type/select/submit blocked by default
- type/submit value preview redacted

**Step 2: Implement resolver**

No action execution in this task.

**Step 3: Run tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml browser_agent
```

Expected: PASS.

---

## Validation Checklist

Run after first slice implementation:

```bash
openspec validate advance-browser-dock-trusted-observation-and-code-bridge --strict --no-interactive
npx vitest run src/features/browser-agent/utils/attachment.test.ts src/features/browser-agent/components/BrowserContextPreview.test.tsx src/features/browser-agent/components/BrowserContextSummaryCard.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml browser_agent
npm run check:large-files:near-threshold && npm run check:large-files:gate
```

If broader UI integration changes touch Composer/Messages send path, also run focused tests for those surfaces.

---

## First Slice Acceptance Criteria

- BrowserContextAttachment contains `observation` with `schemaVersion: 1`.
- Observation state and stale reasons round-trip through `formatBrowserContextPrompt` / parser.
- Composer preview shows observation state and top stale/degraded reason.
- Sent message card shows the same observation state.
- Removed browser context does not enter send path.
- AI payload still injects browser context once.
- Raw DOM/cookies/headers/storage/scripts/styles/password/token/Authorization values remain excluded.
- OpenSpec strict validation passes.
- Focused frontend and Rust tests pass.

---

## Implementation Warnings

- Do not implement OCR in the first slice.
- Do not add `screenshot_ocr` as automatic fallback.
- Do not add `external_provider` as a default transport.
- Do not execute click/type/select/submit.
- Do not create Browser Agent-specific file navigation.
- Do not grow `Composer.tsx` or `BrowserDock.tsx` with heavy logic.
- Do not claim code candidates are definitive ownership.

## Current Reality Calibration - 2026-06-03

This plan originally framed Phase 3 as a constrained first implementation slice. The current browser-related working tree changes have advanced beyond that slice.

### Implemented Beyond Original First Slice

- Detached Browser Dock renderer window and routing.
- Tauri Browser Agent toolbar bridge, capture bridge, snapshot refresh, safe actions, session routing, and toolbar i18n.
- Canonical read-only capture script owned by frontend and included by Rust.
- Evidence inspector, visual evidence references, annotations, action audit trail, and code bridge candidates.
- Browser context propagation into thread messaging, task types, and task run storage.
- Multi-tab toolbar click targeting fix and Browser Dock toolbar i18n propagation added on 2026-06-03.

### Planning Consequence

Future work should not restart from the old first-slice recommendation. The correct next step is verification and hardening:

1. Validate unit/fixture coverage for Browser Agent utilities and capture script.
2. Typecheck the cross-layer DTO/API changes.
3. Manually verify detached window lifecycle, multiple tabs, locale switching, evidence rendering, and code bridge candidate extraction.
4. Only after verification, decide whether to archive the OpenSpec change or split remaining risks into follow-up changes.
