# Claude Compact Command Adaptation Implementation Plan

> **Lifecycle**：Implemented / Historical Plan。Canonical change 已归档于 `openspec/changes/archive/2026-04-21-claude-code-compact-command-adaptation/`；当前 compact lifecycle 以代码与 main specs 为准。
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 `/compact` 在 Claude 线程中成为正式产品命令，同时保持 Codex 现有 compaction 行为不变。

**Architecture:** 在前端 command-routing 层识别 Claude `/compact`，新增 `startCompact()` 复用现有 Claude thread/session send path，再复用已有 `thread/compacting` / `thread/compacted` lifecycle 完成反馈。文案层只澄清 Claude 自动能力边界，不增加新的 runtime contract。

**Tech Stack:** React 19, TypeScript 5, Vitest, Tauri frontend bridge

---

### Task 1: Extend slash command routing

**Files:**
- Modify: `src/features/threads/hooks/useQueuedSend.ts`
- Test: `src/features/threads/hooks/useQueuedSend.test.tsx`

**Step 1: Write the failing test**

Add tests proving:
- `/compact` routes to `startCompact` when `activeEngine === "claude"`
- `/compact` does not route to `startCompact` for `codex`
- `/compact` strips images on the Claude command path

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/features/threads/hooks/useQueuedSend.test.tsx
```

Expected:
- new `/compact` tests fail because `compact` is not a recognized slash command

**Step 3: Write minimal implementation**

In `useQueuedSend.ts`:
- add `startCompact: (text: string) => Promise<void>` to `UseQueuedSendOptions`
- add `"compact"` to `SlashCommandKind`
- update `parseSlashCommand()` to recognize only exact `/compact` head
- add dispatch branch near `/fast` handling:
  - only run when `activeEngine === "claude"`
  - call `startCompact(trimmed)`
  - return `true`

**Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- src/features/threads/hooks/useQueuedSend.test.tsx
```

Expected:
- `/compact` routing tests pass

### Task 2: Implement Claude `startCompact()`

**Files:**
- Modify: `src/features/threads/hooks/useThreadMessaging.ts`
- Test: `src/features/threads/hooks/useThreadMessaging.test.tsx`

**Step 1: Write the failing test**

Add tests proving:
- `startCompact("/compact")` sends `/compact` into the active Claude thread via `sendMessageToThread`
- it uses `skipPromptExpansion: true`
- it sends no images
- if the active thread is not Claude-compatible but an existing Claude thread is resolvable, it rebinds to that thread before dispatch
- if no existing Claude thread is resolvable, it returns actionable failure and does not create a new thread

**Step 2: Run test to verify it fails**

Run:

```bash
npm run test -- src/features/threads/hooks/useThreadMessaging.test.tsx
```

Expected:
- tests fail because `startCompact` does not exist yet

**Step 3: Write minimal implementation**

In `useThreadMessaging.ts`:
- create `startCompact` beside `startFast`
- resolve active workspace
- resolve an existing Claude-compatible thread, or rebind to one if already present elsewhere
- if no existing Claude-compatible thread is available, surface actionable failure and stop
- normalize command to exactly `/compact`
- call `sendMessageToThread(activeWorkspace, threadId, "/compact", [], { skipPromptExpansion: true })`

Expose `startCompact` in the returned hook API and wire it into the caller that constructs `useQueuedSend` options.

**Step 4: Run test to verify it passes**

Run:

```bash
npm run test -- src/features/threads/hooks/useThreadMessaging.test.tsx
```

Expected:
- new `startCompact` tests pass

### Task 3: Keep lifecycle feedback single-sourced

**Files:**
- Test: `src/features/app/hooks/useAppServerEvents.test.tsx`
- Test: `src/features/threads/hooks/useThreadTurnEvents.test.tsx`
- Optional verify: `src/features/composer/components/Composer.tsx`

**Step 1: Add regression tests**

Add/adjust tests proving:
- manual Claude `/compact` success continues to use existing `thread/compacting` and `thread/compacted`
- completion still yields only the existing `Context compacted.` semantic path
- failure does not leave pseudo-processing residue

**Step 2: Run tests**

Run:

```bash
npm run test -- src/features/app/hooks/useAppServerEvents.test.tsx src/features/threads/hooks/useThreadTurnEvents.test.tsx
```

Expected:
- tests either already pass or reveal a missing edge-case assertion

**Step 3: Implement only if needed**

Only touch production code if tests reveal:
- duplicate success messaging
- missing error reset
- missing lifecycle routing for manual compact

Prefer existing lifecycle handlers over new UI paths.

**Step 4: Re-run tests**

Run the same command again and confirm pass.

### Task 4: Clarify user-facing copy

**Files:**
- Modify: `src/i18n/locales/en.part1.ts`
- Modify: `src/i18n/locales/zh.part1.ts`
- Optional verify: `src/features/composer/components/Composer.tsx`

**Step 1: Add copy expectations in tests**

If there are existing tests asserting compact failure copy, extend them to cover:
- Claude manual compact failure copy
- wording that does not imply Codex-style proactive auto-compaction for Claude

**Step 2: Run relevant tests**

Run:

```bash
npm run test -- src/features/threads/hooks/useThreadMessaging.test.tsx
```

**Step 3: Implement minimal copy changes**

Update i18n strings so that:
- Claude auto behavior is described as overflow recovery
- manual `/compact` failure is actionable
- no Codex terminology leaks into Claude copy

**Step 4: Re-run tests**

Run the same command again and confirm pass.

### Task 5: Full validation

**Files:**
- Verify all files touched above

**Step 1: Run focused tests**

```bash
npm run test -- src/features/threads/hooks/useQueuedSend.test.tsx src/features/threads/hooks/useThreadMessaging.test.tsx src/features/app/hooks/useAppServerEvents.test.tsx src/features/threads/hooks/useThreadTurnEvents.test.tsx
```

**Step 2: Run quality gates**

```bash
npm run typecheck
npm run lint
```

**Step 3: Manual verification**

Check three paths:
- Claude thread: `/compact` -> compacting -> compacted -> `Context compacted.`
- Claude thread with forced failure: actionable failure, no stuck processing
- no existing Claude thread: actionable failure, no new thread created
- Codex thread: existing manual/auto compaction unchanged

**Step 4: Prepare implementation summary**

Summarize:
- files changed
- tests run
- manual scenarios verified
- residual risk: non-Claude `/compact` intentionally remains unchanged
