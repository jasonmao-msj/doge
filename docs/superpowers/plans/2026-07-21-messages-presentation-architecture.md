# Messages Presentation Architecture Implementation Plan

> **Lifecycle**：historical implementation plan；对应 OpenSpec change 已归档于 `openspec/changes/archive/2026-07-21-refactor-messages-presentation-architecture/`。下列 checkbox 保留原始执行过程，不是当前 backlog。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在完全保持现有行为的前提下，将 messages 核心三件套重构为高内聚、低耦合、目录合理的 presentation architecture。

**Architecture:** 保留现有 public façade，将 direct helpers、timeline governance 和 row renderers 迁入 `orchestration / timeline / rows`；以七类 typed view models 替代 87 个扁平 timeline props，并保持 stable/live update lane 分离。

**Tech Stack:** React 19、TypeScript、Vitest、TanStack Virtual、ESLint、OpenSpec、Trellis。

---

## Task 1: Capture Baseline

**Files:**
- Inspect: `src/features/messages/**`
- Update: `openspec/changes/refactor-messages-presentation-architecture/tasks.md`

- [ ] Run `npx vitest run src/features/messages` and record the result.
- [ ] Run `npm run typecheck` and record the result.
- [ ] Run `npm run check:large-files` and record the result.
- [ ] Capture current public imports and owner matrix using `rg`.

## Task 2: Move Pure Helpers

**Files:**
- Move: `src/features/messages/components/messagesLiveWindow.ts`
- Move: `src/features/messages/components/messagesViewModel.ts`
- Move: `src/features/messages/components/messagesScrollConvergence.ts`
- Move: `src/features/messages/components/messagesTimelineProjection.ts`
- Move: `src/features/messages/components/messagesTimelineVirtualization.ts`
- Move: `src/features/messages/components/messagesTimelineHydration.ts`
- Move: `src/features/messages/components/messagesRenderLoopGuards.ts`
- Move: `src/features/messages/components/messagesStreamingComplexity.ts`
- Test: corresponding colocated `*.test.ts`

- [ ] Create destination directories and move one implementation owner per helper.
- [ ] Leave old-path re-export files where compatibility is required.
- [ ] Update internal imports to canonical paths.
- [ ] Run helper tests and typecheck.

## Task 3: Add Typed View Models

**Files:**
- Create: `src/features/messages/orchestration/models/messagesTimelineModels.ts`
- Create: `src/features/messages/orchestration/models/messagesControllerModels.ts`
- Modify: `src/features/messages/components/Messages.tsx`
- Modify: `src/features/messages/components/MessagesTimeline.tsx`
- Modify: `src/features/messages/components/messagesTypes.ts`

- [ ] Define stable/live/runtime/navigation/interactions/presentation/slots models using existing concrete types.
- [ ] Build each model with an independent `useMemo` or stable callback group.
- [ ] Replace flat `MessagesTimelineProps` with the seven models.
- [ ] Keep external `MessagesProps` unchanged.
- [ ] Run streaming/timeline focused tests and typecheck.

## Task 4: Decompose Timeline

**Files:**
- Create: `src/features/messages/timeline/components/TimelineLightweightBanner.tsx`
- Create: `src/features/messages/timeline/components/TimelineProjectionRow.tsx`
- Create: `src/features/messages/timeline/virtualization/useTimelineVirtualization.ts`
- Modify: `src/features/messages/components/MessagesTimeline.tsx`

- [ ] Extract low-coupling JSX first.
- [ ] Extract projection row dispatch without changing keys or wrappers.
- [ ] Extract virtualization/hydration controller without changing threshold or measurement ownership.
- [ ] Run projection/virtualization/hydration/jump tests.

## Task 5: Decompose Rows

**Files:**
- Create: `src/features/messages/rows/components/MessageRow.tsx`
- Create: `src/features/messages/rows/components/ReasoningRow.tsx`
- Create: `src/features/messages/rows/components/WorkingIndicator.tsx`
- Create: `src/features/messages/rows/components/ActivityRows.tsx`
- Modify: `src/features/messages/components/MessagesRows.tsx`

- [ ] Move row implementations without editing behavior.
- [ ] Move private comparators and row-local helpers with their owner.
- [ ] Convert `MessagesRows.tsx` into a compatibility export surface.
- [ ] Run row, rich-content, reconnect and mitigation tests.

## Task 6: Decompose Messages Controllers

**Files:**
- Create: `src/features/messages/orchestration/presentation/useMessagesPresentation.ts`
- Create: `src/features/messages/orchestration/interactions/useMessagesInteractions.ts`
- Create: `src/features/messages/orchestration/scrolling/useMessagesScrollController.ts`
- Modify: `src/features/messages/components/Messages.tsx`

- [ ] Move stable/deferred/live presentation derivation to `useMessagesPresentation`.
- [ ] Move copy/toggle/menu/recovery action ownership to `useMessagesInteractions`.
- [ ] Move scroll intent/convergence/timer ownership to `useMessagesScrollController`.
- [ ] Keep root props and public render shell unchanged.
- [ ] Run live behavior, history, jump, scroll and timer cleanup tests.

## Task 7: Cleanup and Full Verification

**Files:**
- Modify: affected compatibility façades and OpenSpec tasks only.

- [ ] Remove dead imports and duplicate implementations.
- [ ] Audit dependency direction with `rg` and ensure no reverse imports.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npx vitest run src/features/messages`.
- [ ] Run `npm run test`.
- [ ] Run `npm run check:large-files`.
- [ ] Run `npm run check:heavy-test-noise`.
- [ ] Run `openspec validate --change refactor-messages-presentation-architecture --strict`.
- [ ] Run `git diff --check` and review the complete diff.
