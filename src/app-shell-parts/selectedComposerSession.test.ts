import { describe, expect, it } from "vitest";
import {
  extractClaudeForkParentThreadId,
  getThreadComposerSelectionStorageKey,
  normalizeComposerSessionSelectionForThread,
  resolveActiveThreadEngine,
  shouldApplyDraftComposerSelectionToThread,
  shouldInheritComposerSelectionFromClaudeForkParent,
  shouldMigrateComposerSelectionBetweenThreadIds,
  shouldSyncActiveThreadEngine,
  type ComposerSessionSelection,
} from "./selectedComposerSession";

describe("selectedComposerSession", () => {
  const identity = (threadId: string) => threadId;
  const draftSelection: ComposerSessionSelection = {
    modelId: "gpt-5.4",
    effort: "high",
  };

  it("builds a workspace-scoped session key for each thread", () => {
    expect(getThreadComposerSelectionStorageKey("ws-a", "codex:session-1")).toBe(
      "selectedModelByThread.ws-a:codex:session-1",
    );
    expect(getThreadComposerSelectionStorageKey("ws-b", "codex:session-1")).toBe(
      "selectedModelByThread.ws-b:codex:session-1",
    );
  });

  it("uses a native thread id to resolve the engine during cold start", () => {
    expect(
      resolveActiveThreadEngine({
        threadId: "kimi:session-1",
        fallbackEngine: "codex",
      }),
    ).toBe("kimi");
    expect(
      resolveActiveThreadEngine({
        threadId: "kimi:session-1",
        threadEngine: "claude",
        fallbackEngine: "codex",
      }),
    ).toBe("claude");
  });

  it("resyncs the active thread after global engine restore overwrites it", () => {
    expect(
      shouldSyncActiveThreadEngine({
        threadId: "kimi:session-1",
        activeEngine: "codex",
        activeThreadEngine: "kimi",
      }),
    ).toBe(true);
    expect(
      shouldSyncActiveThreadEngine({
        threadId: "kimi:session-1",
        activeEngine: "kimi",
        activeThreadEngine: "kimi",
      }),
    ).toBe(false);
    expect(
      shouldSyncActiveThreadEngine({
        threadId: null,
        activeEngine: "codex",
        activeThreadEngine: "codex",
      }),
    ).toBe(false);
  });

  it("applies a draft selection to the first pending thread", () => {
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "codex-pending-1",
      }),
    ).toBe(true);
  });

  it("does not apply a draft selection to a finalized thread", () => {
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "codex:session-1",
      }),
    ).toBe(false);
  });

  it("migrates a persisted selection from pending to finalized thread ids", () => {
    expect(
      shouldMigrateComposerSelectionBetweenThreadIds({
        previousThreadId: "codex-pending-1",
        activeThreadId: "codex:session-1",
        previousSessionKey: "selectedModelByThread.ws-a:codex-pending-1",
        activeSessionKey: "selectedModelByThread.ws-a:codex:session-1",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(true);
  });

  it("does not migrate across unrelated threads or engines", () => {
    expect(
      shouldMigrateComposerSelectionBetweenThreadIds({
        previousThreadId: "codex:session-1",
        activeThreadId: "claude:session-2",
        previousSessionKey: "selectedModelByThread.ws-a:codex:session-1",
        activeSessionKey: "selectedModelByThread.ws-a:claude:session-2",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(false);
  });

  it("treats temporary Claude fork ids as Claude children", () => {
    expect(extractClaudeForkParentThreadId("claude-fork:session-1:local-1")).toBe(
      "claude:session-1",
    );
    expect(
      shouldInheritComposerSelectionFromClaudeForkParent({
        activeThreadId: "claude-fork:session-1:local-1",
        hasCandidate: false,
        hasParentSelection: true,
      }),
    ).toBe(true);
  });

  it("normalizes stored effort by thread engine capability", () => {
    expect(
      normalizeComposerSessionSelectionForThread("claude:session-1", {
        modelId: "claude-opus-4-1",
        effort: " high ",
      }),
    ).toEqual({
      modelId: "claude-opus-4-1",
      effort: "high",
    });
    expect(
      normalizeComposerSessionSelectionForThread("claude:session-1", {
        modelId: "claude-opus-4-1",
        effort: "ultra",
      }),
    ).toEqual({
      modelId: "claude-opus-4-1",
      effort: null,
    });
    expect(
      normalizeComposerSessionSelectionForThread("gemini:session-1", {
        modelId: "gemini-2.5-pro",
        effort: "high",
      }),
    ).toEqual({
      modelId: "gemini-2.5-pro",
      effort: null,
    });
    expect(
      normalizeComposerSessionSelectionForThread("grok:session-1", {
        modelId: "grok-4.5",
        effort: " high ",
      }),
    ).toEqual({
      modelId: "grok-4.5",
      effort: "high",
    });
    expect(
      normalizeComposerSessionSelectionForThread("grok:session-1", {
        modelId: "grok-4.5",
        effort: "xhigh",
      }),
    ).toEqual({
      modelId: "grok-4.5",
      effort: null,
    });
    expect(
      normalizeComposerSessionSelectionForThread("codex:session-1", {
        modelId: "gpt-5.4",
        effort: "high",
      }),
    ).toEqual({
      modelId: "gpt-5.4",
      effort: "high",
    });
  });
});
