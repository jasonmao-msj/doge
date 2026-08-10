// @vitest-environment jsdom
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeThreadMessagingHook,
  resetThreadMessagingTestMocks,
  workspace,
} from "./useThreadMessaging.test-utils";
import {
  workspaceScopedHas,
  workspaceScopedSet,
} from "./workspaceScopedMap";

import {
  compactThreadContext,
  engineInterruptTurn,
  engineInterrupt,
  engineSendMessage,
  interruptTurn,
  listGeminiSessions,
  loadClaudeSession,
  projectMemoryCaptureTurnInput,
  resolveEnabledBuiltInAgent,
  sendUserMessage,
} from "../../../services/tauri";
import { getClientStoreSync } from "../../../services/clientStorage";
import { pushErrorToast } from "../../../services/toasts";
import { getGlobalRuntimeNoticesSnapshot } from "../../../services/globalRuntimeNotices";
import { sendSharedSessionTurnRouted } from "../../shared-session/runtime/sendSharedSessionTurn";
import { SharedActiveAttemptObserverError } from "../../shared-session/runtime/sendSharedSessionTurnV2";
import {
  sharedSessionV2AwaitTurnTerminal,
  sharedSessionV2InterruptTurn,
} from "../../shared-session/services/sharedSessions";
import {
  reattachSharedSessionAttempt,
  resetSharedSessionAttemptReattachmentsForTests,
} from "../../shared-session/runtime/reattachSharedSessionAttempt";
import {
  consumeSharedSendAdmission,
  dispatchSharedSendEvent,
  getSharedSendActiveAttemptId,
  getSharedSendState,
  resetSharedSendStateStoreForTests,
  setSharedSendActiveAttempt,
} from "../../shared-session/runtime/sharedSendStateStore";
import {
  resetSharedTargetStoreForTests,
  selectNextTarget,
} from "../../shared-session/target/targetStore";

const CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE =
  "Claude session is still initializing. Wait for the session to finish binding, then send again.";

describe("useThreadMessaging", () => {
  it.each(["claude", "kimi"] as const)(
    "sends the current %s thread provider binding to the engine",
    async (engine) => {
      const threadId = `${engine}:session-1`;
      const { result } = makeThreadMessagingHook(engine, {
        activeThreadId: threadId,
        ensuredThreadId: threadId,
        threadEngineById: { [threadId]: engine },
        providerProfileByThread: { [threadId]: "provider-a" },
      });

      await act(async () => {
        await result.current.sendUserMessage("hello");
      });

      expect(engineSendMessage).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({
          engine,
          threadId,
          providerProfileId: "provider-a",
        }),
      );
    },
  );

  it.each(["claude", "grok", "kimi", "opencode"] as const)(
    "does not block %s sends with non-empty images at client boundary",
    async (engine) => {
      const { result, pushThreadErrorMessage } = makeThreadMessagingHook(engine, {
        activeThreadId: `${engine}:session-1`,
        threadEngineById: {
          [`${engine}:session-1`]: engine,
        },
      });

      await act(async () => {
        await result.current.sendUserMessageToThread(
          workspace,
          `${engine}:session-1`,
          `${engine} send with image`,
          ["/tmp/example.png"],
        );
      });

      expect(pushThreadErrorMessage).not.toHaveBeenCalledWith(
        workspace.id,
        `${engine}:session-1`,
        expect.stringContaining("does not support image input"),
      );
      expect(engineSendMessage).toHaveBeenCalledWith(
        workspace.id,
        expect.objectContaining({
          engine,
          images: ["/tmp/example.png"],
        }),
      );
    },
  );

  it("does not block codex sends with non-empty images at client boundary", async () => {
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-codex-1",
      threadEngineById: {
        "thread-codex-1": "codex",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-codex-1",
        "codex send with image",
        ["/tmp/example.png"],
      );
    });

    expect(pushThreadErrorMessage).not.toHaveBeenCalledWith(
      workspace.id,
      "thread-codex-1",
      expect.stringContaining("does not support image input"),
    );
    // Codex native path uses sendUserMessage, not engineSendMessage.
    expect(sendUserMessage).toHaveBeenCalledWith(
      workspace.id,
      "thread-codex-1",
      "codex send with image",
      expect.objectContaining({
        images: ["/tmp/example.png"],
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalled();
  });

  it("sends a Native custom Codex model with null effort through sendUserMessage", async () => {
    const threadId = "thread-native-custom-codex";
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: threadId,
      threadEngineById: { [threadId]: "codex" },
      resolveComposerSelection: () => ({
        id: "gpt-5.3-codex-spark",
        model: "gpt-5.3-codex-spark",
        source: "custom",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        threadId,
        "hello native custom model",
      );
    });

    expect(sendUserMessage).toHaveBeenCalledWith(
      workspace.id,
      threadId,
      "hello native custom model",
      expect.objectContaining({
        model: "gpt-5.3-codex-spark",
        effort: null,
      }),
    );
    expect(sendSharedSessionTurnRouted).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
  });

  it("treats only non-empty image entries as attachment content for grok", async () => {
    const { result } = makeThreadMessagingHook("grok", {
      activeThreadId: "grok:session-1",
      threadEngineById: {
        "grok:session-1": "grok",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "grok:session-1",
        "grok send without real images",
        ["  ", "\n", ""],
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(engineSendMessage)).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({
        engine: "grok",
        images: null,
      }),
    );
  });

  beforeEach(() => {
    resetThreadMessagingTestMocks();
    resetSharedTargetStoreForTests();
    resetSharedSendStateStoreForTests();
    resetSharedSessionAttemptReattachmentsForTests();
    window.localStorage.removeItem("mossx.sharedV2Send");
  });

  it("routes opencode thread through engineSendMessage", async () => {
    const { result } = makeThreadMessagingHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ engine: "opencode" }),
    );
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("blocks a non-idle Shared V2 submit before optimistic or processing mutations", async () => {
    dispatchSharedSendEvent("ws-1", "shared:thread-busy", { type: "send" });
    const dispatch = vi.fn();
    const {
      result,
      markProcessing,
      recordThreadActivity,
      safeMessageActivity,
    } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-busy",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-busy",
        "must stay draft only",
      );
    });

    expect(sendSharedSessionTurnRouted).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(recordThreadActivity).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "upsertItem" }),
    );
  });

  it("atomically admits only one of two racing Shared V2 submits before optimistic UI", async () => {
    selectNextTarget("ws-1", "shared:thread-race", {
      engine: "codex",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "provider-a:gpt-a",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
      model: "gpt-a",
      reasoning: { effort: "medium" },
    });
    let resolveFirstRoute:
      | ((value: Record<string, unknown>) => void)
      | undefined;
    const firstRoute = new Promise<Record<string, unknown>>((resolve) => {
      resolveFirstRoute = resolve;
    });
    vi.mocked(sendSharedSessionTurnRouted).mockImplementation((input) => {
      const revision = input.sharedSendAdmissionRevision;
      expect(typeof revision).toBe("number");
      expect(
        consumeSharedSendAdmission(
          input.workspaceId,
          input.threadId,
          revision as number,
        ),
      ).toBe(true);
      return firstRoute;
    });
    const dispatch = vi.fn();
    const { result, markProcessing } = makeThreadMessagingHook("codex", {
        activeThreadId: "shared:thread-race",
        dispatch,
      });

    const firstSend = result.current.sendUserMessageToThread(
      workspace,
      "shared:thread-race",
      "first",
    );
    await waitFor(() => {
      expect(sendSharedSessionTurnRouted).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-race",
        "second",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledTimes(1);
    const optimisticUserItemIds = new Set(
      dispatch.mock.calls
        .filter(
          ([action]) =>
            action?.type === "upsertItem" &&
            action.item?.kind === "message" &&
            action.item?.role === "user",
        )
        .map(([action]) => action.item.id),
    );
    expect(optimisticUserItemIds.size).toBe(1);
    expect(markProcessing).toHaveBeenCalledWith(
      "shared:thread-race",
      true,
    );

    resolveFirstRoute?.({ result: { turn: { id: "shared-turn-race" } } });
    await act(async () => {
      await firstSend;
    });
  });

  it("normalizes unsupported shared-session sends back to claude", async () => {
    window.localStorage.setItem("mossx.sharedV2Send", "0");
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("gemini", {
      activeThreadId: "shared:thread-1",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-1",
        "hello shared",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "shared:thread-1",
        engine: "claude",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadEngine",
        threadId: "shared:thread-1",
        engine: "claude",
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("uses active shared engine selection instead of stale thread engine when sending", async () => {
    window.localStorage.setItem("mossx.sharedV2Send", "0");
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-sticky-engine",
      dispatch,
      threadEngineById: {
        "shared:thread-sticky-engine": "codex",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-sticky-engine",
        "切回 claude 后继续发送",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "shared:thread-sticky-engine",
        engine: "claude",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadEngine",
        workspaceId: "ws-1",
        threadId: "shared:thread-sticky-engine",
        engine: "claude",
      }),
    );
  });

  it("uses the current Composer target only during explicit Shared V0 rollback", async () => {
    window.localStorage.setItem("mossx.sharedV2Send", "0");
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-provider-target",
      resolveComposerSelection: () => ({
        id: "provider-model",
        model: "claude-provider-model",
        source: "provider",
        providerProfileId: "provider-openrouter",
        effort: "high",
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-provider-target",
        "hello provider",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "claude",
        model: "claude-provider-model",
        effort: "high",
        target: expect.objectContaining({
          engine: "claude",
          providerProfileId: "provider-openrouter",
          model: "claude-provider-model",
          reasoning: { effort: "high" },
        }),
      }),
    );
  });

  it("fails closed before UI mutations when Shared V2 has no durable Target", async () => {
    const dispatch = vi.fn();
    const { result, markProcessing, recordThreadActivity, pushThreadErrorMessage } =
      makeThreadMessagingHook("claude", {
        activeThreadId: "shared:thread-missing-target",
        dispatch,
        resolveComposerSelection: () => ({
          id: "stale-provider-model",
          model: "stale-provider-model",
          source: "provider",
          providerProfileId: "stale-provider",
          effort: "high",
          collaborationMode: null,
        }),
      });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-missing-target",
        "must not rebuild target from Composer",
      );
    });

    expect(sendSharedSessionTurnRouted).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(recordThreadActivity).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-missing-target",
      expect.stringContaining("目标不完整"),
    );
  });

  it("uses the Shared Target Store instead of a stale global Composer selection", async () => {
    selectNextTarget("ws-1", "shared:thread-provider-store", {
      engine: "codex",
      providerProfileId: "provider-b",
      modelCatalogEntryId: "provider-b:gpt-provider-b",
      providerProfileNameSnapshot: "Provider B",
      providerProfileSource: "managed",
      model: "gpt-provider-b",
      reasoning: { effort: "medium" },
    });
    const dispatch = vi.fn();
    const { result, onDebug } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-provider-store",
      dispatch,
      resolveComposerSelection: () => ({
        id: "stale-claude-model",
        model: "stale-claude-model",
        source: "provider",
        providerProfileId: "provider-a",
        effort: "high",
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-provider-store",
        "use selected target",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        model: "gpt-provider-b",
        effort: "medium",
        target: {
          engine: "codex",
          providerProfileId: "provider-b",
          modelCatalogEntryId: "provider-b:gpt-provider-b",
          providerProfileNameSnapshot: "Provider B",
          providerProfileSource: "managed",
          model: "gpt-provider-b",
          reasoning: { effort: "medium" },
        },
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "model/resolve",
        payload: expect.objectContaining({
          engine: "codex",
          selectedModelId: "provider-b:gpt-provider-b",
          selectedModelSource: "managed",
          resolvedModel: "gpt-provider-b",
          modelForSend: "gpt-provider-b",
        }),
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "turn/start",
        payload: expect.objectContaining({
          engine: "codex",
          providerProfileId: "provider-b",
          modelCatalogEntryId: "provider-b:gpt-provider-b",
          model: "gpt-provider-b",
          effort: "medium",
        }),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadEngine",
        threadId: "shared:thread-provider-store",
        engine: "codex",
      }),
    );
  });

  it("returns the Shared typed commit and prefers a frozen queue target", async () => {
    const threadId = "shared:thread-frozen-target";
    selectNextTarget("ws-1", threadId, {
      engine: "claude",
      providerProfileId: "current-provider",
      modelCatalogEntryId: "current-provider:claude",
      providerProfileNameSnapshot: "Current Provider",
      providerProfileSource: "managed",
      model: "claude-current",
      reasoning: { effort: "high" },
    });
    const frozenTarget = {
      engine: "codex" as const,
      providerProfileId: "queued-provider",
      modelCatalogEntryId: "queued-provider:gpt-5.6-sol",
      providerProfileNameSnapshot: "Queued Provider",
      providerProfileSource: "managed" as const,
      model: "gpt-5.6-sol",
      reasoning: { effort: "max" },
    };
    const committedResponse = {
      status: "accepted",
      runtimeTurnId: "runtime-turn-queued",
      v2: {
        attemptId: "attempt-queued",
        logicalTurnId: "logical-turn-queued",
        committed: true,
        duplicate: false,
      },
    };
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce(
      committedResponse,
    );
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: threadId,
    });

    let response: unknown;
    await act(async () => {
      response = await result.current.sendUserMessageToThread(
        workspace,
        threadId,
        "use frozen target",
        [],
        { sharedExecutionTarget: frozenTarget },
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        model: "gpt-5.6-sol",
        effort: "max",
        target: frozenTarget,
      }),
    );
    expect(response).toEqual(committedResponse);
  });

  it("fails closed for a stale unsupported Shared Target", async () => {
    selectNextTarget("ws-1", "shared:thread-1", {
      engine: "gemini",
      providerProfileId: "provider-gemini",
      modelCatalogEntryId: "provider-gemini:gemini-pro",
      providerProfileNameSnapshot: "Gemini Provider",
      providerProfileSource: "managed",
      model: "gemini-pro",
      reasoning: null,
    });
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-1",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-1",
        "hello shared",
      );
    });
    expect(sendSharedSessionTurnRouted).not.toHaveBeenCalled();
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-1",
      expect.stringContaining("当前 Shared Session 目标暂不可执行"),
    );
  });

  it("rejects a historical Gemini target before creating a replacement thread", async () => {
    const startThreadForWorkspace = vi.fn(async () => "claude-pending-new");
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "gemini:historical-session",
      ensuredThreadId: "gemini:historical-session",
      threadEngineById: {
        "gemini:historical-session": "gemini",
      },
      startThreadForWorkspace,
    });

    await expect(result.current.sendUserMessage("do not switch providers")).rejects.toThrow(
      "Selected CLI engine is disabled by product policy",
    );

    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("disables Claude CLI thinking for shared Claude sends when visibility is off", async () => {
    selectNextTarget("ws-1", "shared:thread-disable-thinking", {
      engine: "claude",
      providerProfileId: null,
      modelCatalogEntryId: "claude-local:sonnet",
      providerProfileNameSnapshot: "本机配置",
      providerProfileSource: "disk",
      model: "sonnet",
      reasoning: null,
    });
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-disable-thinking",
      claudeThinkingVisible: false,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-disable-thinking",
        "hello shared claude",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "shared:thread-disable-thinking",
        engine: "claude",
        disableThinking: true,
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalled();
  });

  it("hides shared native thread id returned from shared send response", async () => {
    const dispatch = vi.fn();
    selectNextTarget("ws-1", "shared:thread-2", {
      engine: "codex",
      providerProfileId: null,
      modelCatalogEntryId: "codex-local:gpt-5.3-codex",
      providerProfileNameSnapshot: "本机配置",
      providerProfileSource: "disk",
      model: "gpt-5.3-codex",
      reasoning: null,
    });
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValue({
      result: { turn: { id: "shared-turn-2" } },
      nativeThreadId: "550e8400-e29b-41d4-a716-446655440000",
    });
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "shared:thread-2",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-2",
        "hello shared hide native",
      );
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "hideThread",
        workspaceId: "ws-1",
        threadId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    );
  });

  it("captures project-memory input on Shared V2 committed path with runtimeTurnId", async () => {
    const sharedThreadId = "shared:thread-memory-capture";
    const onInputMemoryCaptured = vi.fn();
    selectNextTarget("ws-1", sharedThreadId, {
      engine: "claude",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "settings-main",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
      model: "claude-provider-model",
      reasoning: { effort: "high" },
    });
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce({
      result: { turn: { id: "runtime-turn-memory" } },
      nativeThreadId: "claude:native-session-memory",
      runtimeTurnId: "runtime-turn-memory",
      v2: {
        attemptId: "attempt-memory",
        logicalTurnId: "logical-turn-memory",
        committed: true,
        duplicate: false,
      },
    });
    vi.mocked(projectMemoryCaptureTurnInput).mockResolvedValueOnce({
      id: "memory-shared-1",
    } as never);
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: sharedThreadId,
      threadEngineById: { [sharedThreadId]: "claude" },
      onInputMemoryCaptured,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        sharedThreadId,
        "shared memory input capture",
      );
    });

    await waitFor(() => {
      expect(projectMemoryCaptureTurnInput).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          userInput: "shared memory input capture",
          threadId: sharedThreadId,
          turnId: "runtime-turn-memory",
          engine: "claude",
        }),
      );
    });
    await waitFor(() => {
      expect(onInputMemoryCaptured).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          threadId: sharedThreadId,
          turnId: "runtime-turn-memory",
          inputText: "shared memory input capture",
          memoryId: "memory-shared-1",
          engine: "claude",
        }),
      );
    });
  });

  it("does not revive a canonically committed Shared V2 turn from its response", async () => {
    const sharedThreadId = "shared:thread-committed-response";
    const onSharedDurableTurnCommitted = vi.fn();
    selectNextTarget("ws-1", sharedThreadId, {
      engine: "claude",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "settings-main",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
      model: "claude-provider-model",
      reasoning: { effort: "high" },
    });
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce({
      result: { turn: { id: "runtime-turn-already-completed" } },
      nativeThreadId: "claude:native-session-1",
      runtimeTurnId: "runtime-turn-already-completed",
      v2: {
        attemptId: "attempt-committed",
        logicalTurnId: "logical-turn-committed",
        committed: true,
        duplicate: false,
      },
    });
    const { result, markProcessing, setActiveTurnId } =
      makeThreadMessagingHook("claude", {
        activeThreadId: sharedThreadId,
        threadEngineById: { [sharedThreadId]: "claude" },
        onSharedDurableTurnCommitted,
      });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        sharedThreadId,
        "finish without revival",
      );
    });

    expect(onSharedDurableTurnCommitted).toHaveBeenCalledWith(
      sharedThreadId,
      "runtime-turn-already-completed",
    );
    expect(markProcessing).toHaveBeenCalledWith(sharedThreadId, false);
    expect(setActiveTurnId).toHaveBeenCalledWith(sharedThreadId, null);
    expect(
      onSharedDurableTurnCommitted.mock.invocationCallOrder[0],
    ).toBeLessThan(
      markProcessing.mock.invocationCallOrder.find(
        (_order, index) =>
          markProcessing.mock.calls[index]?.[0] === sharedThreadId &&
          markProcessing.mock.calls[index]?.[1] === false,
      ) ?? Number.POSITIVE_INFINITY,
    );
    expect(setActiveTurnId).not.toHaveBeenCalledWith(
      sharedThreadId,
      "runtime-turn-already-completed",
    );
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("keeps Shared processing attached when only the terminal observer detached", async () => {
    const sharedThreadId = "shared:thread-observer-detached";
    const attemptId = "attempt-observer-detached";
    selectNextTarget("ws-1", sharedThreadId, {
      engine: "codex",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "settings-gpt-5",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
      model: "gpt-5",
      reasoning: { effort: "high" },
    });
    setSharedSendActiveAttempt("ws-1", sharedThreadId, attemptId);
    vi.mocked(sendSharedSessionTurnRouted).mockImplementationOnce((input) => {
      expect(
        consumeSharedSendAdmission(
          input.workspaceId,
          input.threadId,
          input.sharedSendAdmissionRevision ?? -1,
        ),
      ).toBe(true);
      return Promise.reject(
        new SharedActiveAttemptObserverError(
          attemptId,
          new Error("frontend observer detached"),
        ),
      );
    });
    const {
      result,
      markProcessing,
      setActiveTurnId,
      pushThreadErrorMessage,
      onDebug,
    } =
      makeThreadMessagingHook("codex", {
        activeThreadId: sharedThreadId,
        threadEngineById: { [sharedThreadId]: "codex" },
      });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        sharedThreadId,
        "keep running",
      );
    });

    expect(markProcessing).toHaveBeenCalledWith(sharedThreadId, true);
    expect(markProcessing).not.toHaveBeenCalledWith(sharedThreadId, false);
    expect(setActiveTurnId).not.toHaveBeenCalledWith(sharedThreadId, null);
    expect(getSharedSendActiveAttemptId("ws-1", sharedThreadId)).toBe(
      attemptId,
    );
    expect(pushThreadErrorMessage).not.toHaveBeenCalled();
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "shared terminal observer detached",
        payload: expect.objectContaining({ attemptId }),
      }),
    );
  });

  it("converges thread processing when a reattached Attempt reaches durable terminal", async () => {
    const sharedThreadId = "shared:thread-reattached-terminal";
    const onSharedDurableTurnCommitted = vi.fn();
    const { markProcessing, setActiveTurnId } = makeThreadMessagingHook(
      "codex",
      {
        activeThreadId: sharedThreadId,
        threadEngineById: { [sharedThreadId]: "codex" },
        onSharedDurableTurnCommitted,
      },
    );
    dispatchSharedSendEvent("ws-1", sharedThreadId, { type: "send" });
    dispatchSharedSendEvent("ws-1", sharedThreadId, {
      type: "packagePrepared",
    });
    dispatchSharedSendEvent("ws-1", sharedThreadId, {
      type: "ackAmbiguous",
    });
    vi.mocked(sharedSessionV2AwaitTurnTerminal).mockResolvedValueOnce({
      status: "committed",
      duplicate: false,
      sequence: 17,
      bindingKey: "codex:provider-a",
      terminal: {
        type: "run.settled",
        outcome: "completed",
        recoveryReason: null,
      },
    });

    await act(async () => {
      await reattachSharedSessionAttempt("ws-1", sharedThreadId, {
        status: "active",
        attemptId: "attempt-reattached-terminal",
        bindingKey: "codex:provider-a",
        nativeThreadId: "native-reattached-terminal",
        runtimeTurnId: "runtime-reattached-terminal",
        executionTargetSnapshot: {
          engine: "codex",
          providerProfileId: "provider-a",
          modelCatalogEntryId: "settings-gpt-5",
          model: "gpt-5",
          reasoning: { effort: "high" },
          providerProfileNameSnapshot: "Provider A",
          providerProfileSource: "managed",
          runtimeCapabilityFingerprint: null,
        },
      });
    });

    expect(onSharedDurableTurnCommitted).toHaveBeenCalledWith(
      sharedThreadId,
      "runtime-reattached-terminal",
    );
    expect(markProcessing).toHaveBeenCalledWith(sharedThreadId, false);
    expect(setActiveTurnId).toHaveBeenCalledWith(sharedThreadId, null);
    expect(getSharedSendState("ws-1", sharedThreadId).state).toBe("idle");
  });

  it("installs a stale observer terminal barrier without clearing a newer Attempt", async () => {
    const sharedThreadId = "shared:thread-stale-reattachment";
    const onSharedDurableTurnCommitted = vi.fn();
    const { markProcessing, setActiveTurnId } = makeThreadMessagingHook(
      "codex",
      {
        activeThreadId: sharedThreadId,
        threadEngineById: { [sharedThreadId]: "codex" },
        onSharedDurableTurnCommitted,
      },
    );
    dispatchSharedSendEvent("ws-1", sharedThreadId, { type: "send" });
    dispatchSharedSendEvent("ws-1", sharedThreadId, {
      type: "packagePrepared",
    });
    dispatchSharedSendEvent("ws-1", sharedThreadId, {
      type: "ackAmbiguous",
    });
    let resolveTerminal!: (
      value: Awaited<ReturnType<typeof sharedSessionV2AwaitTurnTerminal>>,
    ) => void;
    vi.mocked(sharedSessionV2AwaitTurnTerminal).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTerminal = resolve;
      }),
    );
    const staleObserver = reattachSharedSessionAttempt(
      "ws-1",
      sharedThreadId,
      {
        status: "active",
        attemptId: "attempt-stale",
        bindingKey: "codex:provider-a",
        nativeThreadId: "native-stale",
        runtimeTurnId: "runtime-stale",
        executionTargetSnapshot: {
          engine: "codex",
          providerProfileId: "provider-a",
          modelCatalogEntryId: "settings-gpt-5",
          model: "gpt-5",
          reasoning: { effort: "high" },
          providerProfileNameSnapshot: "Provider A",
          providerProfileSource: "managed",
          runtimeCapabilityFingerprint: null,
        },
      },
    );
    setSharedSendActiveAttempt(
      "ws-1",
      sharedThreadId,
      "attempt-current",
    );

    await act(async () => {
      resolveTerminal({
        status: "committed",
        duplicate: false,
        sequence: 18,
        bindingKey: "codex:provider-a",
        terminal: {
          type: "run.settled",
          outcome: "completed",
          recoveryReason: null,
        },
      });
      await staleObserver;
    });

    expect(onSharedDurableTurnCommitted).toHaveBeenCalledWith(
      sharedThreadId,
      "runtime-stale",
    );
    expect(markProcessing).not.toHaveBeenCalledWith(sharedThreadId, false);
    expect(setActiveTurnId).not.toHaveBeenCalledWith(sharedThreadId, null);
    expect(getSharedSendActiveAttemptId("ws-1", sharedThreadId)).toBe(
      "attempt-current",
    );
  });

  it("records missing Runtime identity instead of fabricating a durable terminal barrier", async () => {
    const sharedThreadId = "shared:thread-missing-runtime-id";
    const onSharedDurableTurnCommitted = vi.fn();
    selectNextTarget("ws-1", sharedThreadId, {
      engine: "claude",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "settings-main",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
      model: "kimi-for-coding",
      reasoning: null,
    });
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce({
      result: { turn: { id: "nested-id-must-not-be-used" } },
      nativeThreadId: "claude:native-session-2",
      v2: {
        attemptId: "attempt-missing-runtime",
        logicalTurnId: "logical-missing-runtime",
        committed: true,
        duplicate: false,
      },
    });
    const { result, onDebug } = makeThreadMessagingHook("claude", {
      activeThreadId: sharedThreadId,
      threadEngineById: { [sharedThreadId]: "claude" },
      onSharedDurableTurnCommitted,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        sharedThreadId,
        "finish with malformed response",
      );
    });

    expect(onSharedDurableTurnCommitted).not.toHaveBeenCalled();
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "shared-session/durable-terminal-runtime-id-missing",
        payload: expect.objectContaining({
          threadId: sharedThreadId,
          attemptId: "attempt-missing-runtime",
          logicalTurnId: "logical-missing-runtime",
        }),
      }),
    );
  });

  it("passes custom spec root through cli engine send when configured", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });
    const { result } = makeThreadMessagingHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "opencode-pending-abc", "hello");
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        customSpecRoot: "/tmp/external-openspec",
      }),
    );
  });

  it("sanitizes leaked claude model for opencode", async () => {
    const { result } = makeThreadMessagingHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
        [],
        { model: "claude-sonnet-4-5" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        model: "openai/gpt-5.3-codex",
      }),
    );
  });

  it("sanitizes leaked claude model for codex", async () => {
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
        [],
        { model: "claude-sonnet-4-5" },
      );
    });

    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "hello codex",
      expect.objectContaining({
        model: null,
      }),
    );
  });

  it("keeps custom claude model ids for claude engine", async () => {
    const { result } = makeThreadMessagingHook("claude");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: "GLM-5.1" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "GLM-5.1",
      }),
    );
  });

  it("disables Claude CLI thinking when Claude thinking visibility is off", async () => {
    const { result } = makeThreadMessagingHook("claude", {
      claudeThinkingVisible: false,
      threadEngineById: { "claude:session-1": "claude" },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude:session-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        disableThinking: true,
      }),
    );
  });

  it("does not disable non-Claude thinking from the Claude visibility toggle", async () => {
    const { result } = makeThreadMessagingHook("opencode", {
      claudeThinkingVisible: false,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "opencode",
        disableThinking: false,
      }),
    );
  });

  it("sends resolved Claude runtime model while diagnostics keep selected id and source", async () => {
    const { result, onDebug } = makeThreadMessagingHook("claude", {
      resolveComposerSelection: () => ({
        id: "claude-sonnet-option",
        model: "sonnet",
        source: "cli-discovered",
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "sonnet",
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "model/resolve",
        payload: expect.objectContaining({
          selectedModelId: "claude-sonnet-option",
          selectedModelSource: "cli-discovered",
          modelForSend: "sonnet",
        }),
      }),
    );
  });

  it("sends custom Claude model ids with bracket suffix to the backend", async () => {
    const { result, onDebug } = makeThreadMessagingHook("claude", {
      resolveComposerSelection: () => ({
        id: "Cxn[1m]",
        model: "Cxn[1m]",
        source: "custom",
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "Cxn[1m]",
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        model: "claude-opus-4-6[1m]",
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "model/resolve",
        payload: expect.objectContaining({
          selectedModelId: "Cxn[1m]",
          selectedModelSource: "custom",
          modelForSend: "Cxn[1m]",
        }),
      }),
    );
  });

  it("keeps custom claude model ids with slash/colon/brackets for claude engine", async () => {
    const { result } = makeThreadMessagingHook("claude");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: "provider/model:202603[beta]" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "provider/model:202603[beta]",
      }),
    );
  });

  it("passes arbitrary claude custom model ids through to the backend", async () => {
    const { result } = makeThreadMessagingHook("claude");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: "bad model with spaces" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "bad model with spaces",
      }),
    );
  });

  it("passes overlong claude custom model ids through to the backend", async () => {
    const { result } = makeThreadMessagingHook("claude");
    const overlongModelId = `m${"x".repeat(128)}`;

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: overlongModelId },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: overlongModelId,
      }),
    );
  });

  it("rejects direct and queue-fusion sends to Gemini before side effects", async () => {
    const { result } = makeThreadMessagingHook("gemini");

    await expect(
      result.current.sendUserMessageToThread(
        workspace,
        "gemini-pending-abc",
        "hello gemini",
      ),
    ).rejects.toThrow("Selected CLI engine is disabled by product policy");
    await expect(
      result.current.sendUserMessageToThread(
        workspace,
        "gemini:session-1",
        "queued follow up",
        [],
        { resumeSource: "queue-fusion-cutover" },
      ),
    ).rejects.toThrow("Selected CLI engine is disabled by product policy");

    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(listGeminiSessions).not.toHaveBeenCalled();
  });

  it.each([
    ["claude", "claude:session-1"],
    ["codex", "thread-1"],
    ["opencode", "opencode:session-1"],
  ] as const)(
    "clears stale interrupted guard before a new %s send starts",
    async (engine, threadId) => {
      const { result, interruptedThreadsRef } = makeThreadMessagingHook(engine, {
        activeThreadId: threadId,
        ensuredThreadId: threadId,
        threadEngineById:
          engine === "codex"
            ? { [threadId]: "codex" }
            : { [threadId]: engine },
      });
      workspaceScopedSet(interruptedThreadsRef.current, workspace.id, threadId, true);

      await act(async () => {
        await result.current.sendUserMessageToThread(
          workspace,
          threadId,
          "hello again",
        );
      });

      expect(workspaceScopedHas(interruptedThreadsRef.current, workspace.id, threadId)).toBe(false);
    },
  );

  it("does not trigger auto title generation for opencode", async () => {
    const { result } = makeThreadMessagingHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not trigger auto title generation for codex", async () => {
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("does not trigger auto title generation for claude", async () => {
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude:session-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
  });

  it("blocks claude pending follow-up until native session confirmation arrives", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        sessionId: "session-xyz",
        result: { turn: { id: "turn-1" }, sessionId: "session-xyz" },
      });
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-abc",
      ensuredThreadId: "claude-pending-abc",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-abc",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-abc",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenNthCalledWith(
      1,
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: false,
        sessionId: null,
        threadId: "claude-pending-abc",
      }),
    );
    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "claude-pending-abc",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });

  it("rebinds claude pending follow-up after candidate transcript validates", async () => {
    const workspaceWithTrailingSpace = { ...workspace, path: "/tmp/mossx " };
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        sessionId: "session-xyz",
        result: { turn: { id: "turn-1" }, sessionId: "session-xyz" },
      })
      .mockResolvedValueOnce({
        sessionId: "session-xyz",
        result: { turn: { id: "turn-2" }, sessionId: "session-xyz" },
      });
    vi.mocked(loadClaudeSession).mockResolvedValueOnce({
      messages: [
        {
          kind: "message",
          id: "user-1",
          role: "user",
          text: "hello claude",
        },
        {
          kind: "message",
          id: "assistant-1",
          role: "assistant",
          text: "done",
        },
      ],
    });
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-abc",
      ensuredThreadId: "claude-pending-abc",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspaceWithTrailingSpace,
        "claude-pending-abc",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspaceWithTrailingSpace,
        "claude-pending-abc",
        "follow up",
      );
    });

    expect(loadClaudeSession).toHaveBeenCalledWith("/tmp/mossx ", "session-xyz");
    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "claude-pending-abc",
      newThreadId: "claude:session-xyz",
    });
    expect(engineSendMessage).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: true,
        sessionId: "session-xyz",
        threadId: "claude:session-xyz",
      }),
    );
    expect(pushThreadErrorMessage).not.toHaveBeenCalledWith(
      "claude-pending-abc",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });

  it("does not rebind claude pending follow-up from user-only candidate transcript", async () => {
    vi.mocked(engineSendMessage).mockResolvedValueOnce({
      sessionId: "session-user-only",
      result: { turn: { id: "turn-1" }, sessionId: "session-user-only" },
    });
    vi.mocked(loadClaudeSession).mockResolvedValueOnce({
      messages: [
        {
          kind: "message",
          id: "user-1",
          role: "user",
          text: "hello claude",
        },
      ],
    });
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-user-only",
      ensuredThreadId: "claude-pending-user-only",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-user-only",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-user-only",
        "follow up too early",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "claude-pending-user-only",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });

  it("blocks restored claude pending thread with local items even without memory marker", async () => {
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-restored",
      ensuredThreadId: "claude-pending-restored",
      itemsByThread: {
        "claude-pending-restored": [
          {
            id: "user-1",
            kind: "message",
            role: "user",
            text: "hello claude",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-restored",
        "follow up after remount",
      );
    });

    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "claude-pending-restored",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });

  it("passes forkSessionId for the first send on a claude fork thread", async () => {
    vi.mocked(engineSendMessage).mockResolvedValueOnce({
      sessionId: "new-child-session",
      result: { turn: { id: "turn-1" }, sessionId: "new-child-session" },
    });
    const threadId = "claude-fork:parent-session-1:local-1";
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: threadId,
      ensuredThreadId: threadId,
      threadEngineById: {
        [threadId]: "claude",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        threadId,
        "hello from fork",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: false,
        sessionId: null,
        forkSessionId: "parent-session-1",
        threadId,
      }),
    );
  });

  it("does not accept snake_case claude session_id as pending native confirmation", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        result: {
          turn: { id: "turn-1" },
          session_id: "session-snake",
        },
      });
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-snake",
      ensuredThreadId: "claude-pending-snake",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-snake",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-snake",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "claude-pending-snake",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });

  it("continues finalized claude session with native thread id", async () => {
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-native-1",
      ensuredThreadId: "claude:session-native-1",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude:session-native-1",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: true,
        sessionId: "session-native-1",
        threadId: "claude:session-native-1",
      }),
    );
  });

  it("does not treat thread id as claude session id fallback", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        result: {
          turn: { id: "turn-1" },
          thread: { id: "claude:session-from-thread-id" },
        },
      });
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-def",
      ensuredThreadId: "claude-pending-def",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-def",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-def",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "claude-pending-def",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });

  it("routes by thread ownership when active engine mismatches", async () => {
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ engine: "opencode" }),
    );
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("runs /compact in active claude thread via dedicated compact RPC", async () => {
    vi.mocked(compactThreadContext).mockResolvedValue({
      status: "completed",
      turnId: "compact-turn-1",
    });
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      threadEngineById: {
        "claude:session-1": "claude",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact now");
    });

    expect(compactThreadContext).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "claude:session-1",
      isCompacting: true,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "claude:session-1",
      isCompacting: false,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendContextCompacted",
      threadId: "claude:session-1",
      turnId: "compact-turn-1",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      expect.any(Number),
    );
    expect(safeMessageActivity).toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("runs manual Codex compaction via dedicated compact RPC and inserts the curtain message immediately", async () => {
    vi.mocked(compactThreadContext).mockResolvedValue({ status: "queued" });
    const {
      result,
      dispatch,
      recordThreadActivity,
      safeMessageActivity,
      codexCompactionInFlightByThreadRef,
    } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "codex",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: true,
      timestamp: expect.any(Number),
      source: "manual",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionStarted",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      expect.any(Number),
    );
    expect(codexCompactionInFlightByThreadRef.current["thread-1"]).toBe(true);
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("routes Shared Codex manual compaction through the logical Shared owner", async () => {
    vi.mocked(compactThreadContext).mockResolvedValue({ status: "queued" });
    const threadId = "shared:codex-session-1";
    const {
      result,
      dispatch,
      codexCompactionInFlightByThreadRef,
    } = makeThreadMessagingHook("codex", {
      activeThreadId: threadId,
      ensuredThreadId: threadId,
      threadEngineById: {
        [threadId]: "codex",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).toHaveBeenCalledWith("ws-1", threadId);
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId,
      isCompacting: true,
      timestamp: expect.any(Number),
      source: "manual",
    });
    expect(codexCompactionInFlightByThreadRef.current[threadId]).toBe(true);
  });

  it("routes Shared Claude manual compaction without requiring a claude-prefixed id", async () => {
    vi.mocked(compactThreadContext).mockResolvedValue({
      result: { turnId: "shared-compact-turn-1" },
    });
    const threadId = "shared:claude-session-1";
    const { result, dispatch } = makeThreadMessagingHook("claude", {
      activeThreadId: threadId,
      ensuredThreadId: threadId,
      threadEngineById: {
        [threadId]: "claude",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).toHaveBeenCalledWith("ws-1", threadId);
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId,
      isCompacting: true,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendContextCompacted",
      threadId,
      turnId: "shared-compact-turn-1",
    });
  });

  it("does not send duplicate Codex compact RPCs while one is already in flight", async () => {
    const {
      result,
      dispatch,
      codexCompactionInFlightByThreadRef,
    } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "codex",
      },
    });
    codexCompactionInFlightByThreadRef.current["thread-1"] = true;

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendCodexCompactionMessage" }),
    );
  });

  it("rolls back the started Codex compaction curtain message when the compact RPC fails immediately", async () => {
    vi.mocked(compactThreadContext).mockRejectedValue(new Error("rpc failed"));
    const {
      result,
      dispatch,
      codexCompactionInFlightByThreadRef,
      pushThreadErrorMessage,
      safeMessageActivity,
    } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "codex",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "discardLatestCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionStarted",
    });
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "thread-1",
      "threads.contextCompactionFailedWithMessage",
    );
    expect(codexCompactionInFlightByThreadRef.current["thread-1"]).toBeUndefined();
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("does not create a new thread for /compact when no active claude thread exists", async () => {
    const startThreadForWorkspace = vi.fn(async () => "claude:session-new");
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: null,
      ensuredThreadId: null,
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.claudeManualCompactUnavailable",
      }),
    );
  });

  it("rejects /compact on unsupported active thread without rebinding", async () => {
    const startThreadForWorkspace = vi.fn(async () => "claude:session-new");
    const { result } = makeThreadMessagingHook("gemini", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "gemini",
      },
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.claudeManualCompactUnavailable",
      }),
    );
  });

  it("rejects /compact on pending claude thread to avoid creating a session just for compaction", async () => {
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-123",
      ensuredThreadId: "claude-pending-123",
      threadEngineById: {
        "claude-pending-123": "claude",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.claudeManualCompactUnavailable",
      }),
    );
  });

  it("interrupt routes codex thread through daemon rpc even when active engine is opencode", async () => {
    const { result } = makeThreadMessagingHook("opencode", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      activeTurnIdByThread: { "thread-1": "turn-1" },
      threadEngineById: { "thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(interruptTurn).toHaveBeenCalledWith("ws-1", "thread-1", "turn-1", null);
    expect(engineInterrupt).toHaveBeenCalledWith("ws-1");
  });

  it("shows fusion-specific stop copy without blocking same-thread realtime continuation", async () => {
    const { result, dispatch, interruptedThreadsRef, pendingInterruptsRef } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      activeTurnIdByThread: { "thread-1": "turn-1" },
      threadEngineById: { "thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn({ reason: "queue-fusion" });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "addAssistantMessage",
      threadId: "thread-1",
      text: "正在切换到融合回复，等待新的接续事件…",
    });
    expect(workspaceScopedHas(interruptedThreadsRef.current, workspace.id, "thread-1")).toBe(false);
    expect(workspaceScopedHas(pendingInterruptsRef.current, workspace.id, "thread-1")).toBe(false);
  });

  it("keeps the default stop copy for a normal manual interrupt", async () => {
    const { result, dispatch, interruptedThreadsRef } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      activeTurnIdByThread: { "thread-1": "turn-1" },
      threadEngineById: { "thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "addAssistantMessage",
      threadId: "thread-1",
      text: "会话已停止。",
    });
    expect(workspaceScopedHas(interruptedThreadsRef.current, workspace.id, "thread-1")).toBe(true);
  });

  it("keeps plan handoff interrupts silent while still stopping the active turn", async () => {
    const { result, dispatch, markProcessing, setActiveTurnId } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      activeTurnIdByThread: { "claude:session-1": "turn-1" },
      threadEngineById: { "claude:session-1": "claude" },
    });

    await act(async () => {
      await result.current.interruptTurn({ reason: "plan-handoff" });
    });

    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("claude:session-1", null);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "claude:session-1",
      }),
    );
    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-1", "claude");
  });

  it("routes a shared Claude interrupt to the active provider binding", async () => {
    setSharedSendActiveAttempt("ws-1", "shared:thread-1", "attempt-claude");
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-1",
      ensuredThreadId: "shared:thread-1",
      activeTurnIdByThread: { "shared:thread-1": "turn-1" },
      threadEngineById: { "shared:thread-1": "claude" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(sharedSessionV2InterruptTurn).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-1",
      "attempt-claude",
    );
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("routes a shared Codex interrupt only through its durable attempt owner", async () => {
    setSharedSendActiveAttempt("ws-1", "shared:thread-1", "attempt-codex");
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "shared:thread-1",
      ensuredThreadId: "shared:thread-1",
      activeTurnIdByThread: { "shared:thread-1": "ui-turn-stale" },
      threadEngineById: { "shared:thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(sharedSessionV2InterruptTurn).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-1",
      "attempt-codex",
    );
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(engineInterruptTurn).not.toHaveBeenCalled();
  });

  it("interrupts a durable Shared attempt even when the native reducer has no active turn", async () => {
    setSharedSendActiveAttempt("ws-1", "shared:thread-1", "attempt-durable");
    const { result, markProcessing, setActiveTurnId } =
      makeThreadMessagingHook("claude", {
        activeThreadId: "shared:thread-1",
        ensuredThreadId: "shared:thread-1",
        activeTurnIdByThread: {},
        threadStatusById: {},
        threadEngineById: { "shared:thread-1": "claude" },
      });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(sharedSessionV2InterruptTurn).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-1",
      "attempt-durable",
    );
    expect(markProcessing).toHaveBeenCalledWith("shared:thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("shared:thread-1", null);
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("converges a canonically committed Shared attempt without adding a stop notice", async () => {
    setSharedSendActiveAttempt("ws-1", "shared:thread-1", "attempt-committed");
    vi.mocked(sharedSessionV2InterruptTurn).mockResolvedValueOnce({
      status: "terminal-committed",
      attemptId: "attempt-committed",
      sequence: 12,
    });
    const { result, dispatch, markProcessing, setActiveTurnId } =
      makeThreadMessagingHook("claude", {
        activeThreadId: "shared:thread-1",
        ensuredThreadId: "shared:thread-1",
        activeTurnIdByThread: { "shared:thread-1": "stale-ui-turn" },
        threadEngineById: { "shared:thread-1": "claude" },
      });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(getSharedSendActiveAttemptId("ws-1", "shared:thread-1")).toBeNull();
    expect(getSharedSendState("ws-1", "shared:thread-1").state).toBe("idle");
    expect(markProcessing).toHaveBeenCalledWith("shared:thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("shared:thread-1", null);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "shared:thread-1",
      }),
    );
  });

  it("clears an idle Shared V2 UI residue when the attempt owner is already released", async () => {
    const { result, markProcessing, setActiveTurnId } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-1",
      ensuredThreadId: "shared:thread-1",
      activeTurnIdByThread: { "shared:thread-1": "ui-turn-1" },
      threadStatusById: {
        "shared:thread-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 1,
          lastDurationMs: null,
        },
      },
      threadEngineById: { "shared:thread-1": "claude" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(sharedSessionV2InterruptTurn).not.toHaveBeenCalled();
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(markProcessing).toHaveBeenCalledWith("shared:thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("shared:thread-1", null);
  });

  it("fails closed when a non-idle Shared V2 interrupt has no attempt owner", async () => {
    dispatchSharedSendEvent("ws-1", "shared:thread-1", { type: "send" });
    dispatchSharedSendEvent("ws-1", "shared:thread-1", {
      type: "packagePrepared",
    });
    dispatchSharedSendEvent("ws-1", "shared:thread-1", {
      type: "runtimeAck",
    });
    const { result, markProcessing, setActiveTurnId } =
      makeThreadMessagingHook("claude", {
        activeThreadId: "shared:thread-1",
        ensuredThreadId: "shared:thread-1",
        activeTurnIdByThread: { "shared:thread-1": "ui-turn-1" },
        threadEngineById: { "shared:thread-1": "claude" },
      });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(getSharedSendState("ws-1", "shared:thread-1").state).toBe("running");
    expect(sharedSessionV2InterruptTurn).not.toHaveBeenCalled();
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(setActiveTurnId).not.toHaveBeenCalled();
  });

  it("interrupt routes opencode thread through engine interrupt only", async () => {
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "opencode:session-1",
      ensuredThreadId: "opencode:session-1",
      activeTurnIdByThread: { "opencode:session-1": "turn-9" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-9", "opencode");
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("falls back to workspace interrupt when turn-scoped interrupt rpc is unavailable", async () => {
    vi.mocked(engineInterruptTurn).mockRejectedValue(
      new Error("unknown method: engine_interrupt_turn"),
    );
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "opencode:session-1",
      ensuredThreadId: "opencode:session-1",
      activeTurnIdByThread: { "opencode:session-1": "turn-9" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-9", "opencode");
    expect(engineInterrupt).toHaveBeenCalledWith("ws-1");
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("interrupt on cli-managed engine queues pending interrupt when turn id is not ready", async () => {
    const { result, pendingInterruptsRef } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      activeTurnIdByThread: {},
      threadStatusById: {
        "claude:session-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 1,
          lastDurationMs: null,
        },
      },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, workspace.id, "claude:session-1")).toBe(true);
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("does not queue a pending interrupt after a stalled codex turn already settled", async () => {
    const { result, pendingInterruptsRef, dispatch } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-stalled",
      ensuredThreadId: "thread-stalled",
      activeTurnIdByThread: { "thread-stalled": null },
      threadEngineById: { "thread-stalled": "codex" },
      threadStatusById: {
        "thread-stalled": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: null,
          lastDurationMs: 120_000,
        },
      },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, workspace.id, "thread-stalled")).toBe(false);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "thread-stalled",
      }),
    );
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
  });

  it("clears queued pending interrupt before starting a new claude send", async () => {
    const { result, pendingInterruptsRef } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      activeTurnIdByThread: {},
    });
    workspaceScopedSet(pendingInterruptsRef.current, workspace.id, "claude:session-1", true);

    await act(async () => {
      await result.current.sendUserMessage("resume execution", [], {
        accessMode: "default",
        collaborationMode: { mode: "code", settings: {} },
        suppressUserMessageRender: true,
      });
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, workspace.id, "claude:session-1")).toBe(false);
    expect(engineSendMessage).toHaveBeenCalled();
  });

  it("creates new opencode pending thread when active thread id is not opencode-prefixed", async () => {
    const startThreadForWorkspace = vi.fn(async () => "opencode-pending-new");
    const { result } = makeThreadMessagingHook("opencode", {
      activeThreadId: "thread-legacy",
      ensuredThreadId: "thread-legacy",
      threadEngineById: { "thread-legacy": "opencode" },
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello");
    });

    expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      activate: true,
      engine: "opencode",
    });
    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "opencode",
        threadId: "opencode-pending-new",
      }),
    );
  });

  it("keeps sending follow-up messages on the current compatible codex thread", async () => {
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: { "thread-1": "codex" },
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up");
    });

    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "follow up",
      expect.any(Object),
    );
  });

  it("shows create-session loading when first send needs to create a thread", async () => {
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const runWithCreateSessionLoading = vi.fn(async (_params, action) => action());
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: null,
      ensuredThreadId: "thread-new-1",
      startThreadForWorkspace,
      runWithCreateSessionLoading,
    });

    await act(async () => {
      await result.current.sendUserMessage("first message");
    });

    expect(runWithCreateSessionLoading).toHaveBeenCalledWith(
      {
        workspace,
        engine: "codex",
      },
      expect.any(Function),
    );
    expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      activate: true,
      engine: "codex",
    });
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-new-1",
      "first message",
      expect.any(Object),
    );
  });

  it("passes selected Codex provider profile when first send creates a managed-provider thread", async () => {
    const startThreadForWorkspace = vi.fn(async () => "thread-provider-1");
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: null,
      ensuredThreadId: "thread-provider-1",
      startThreadForWorkspace,
      resolveComposerSelection: () => ({
        id: "minimax-m3",
        model: "minimax-m3",
        source: "custom",
        providerProfileId: "provider-minimax",
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessage("first provider message");
    });

    expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      activate: true,
      engine: "codex",
      providerProfileId: "provider-minimax",
    });
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-provider-1",
      "first provider message",
      expect.any(Object),
    );
  });

  it("does not show create-session loading for follow-up sends on existing threads", async () => {
    const runWithCreateSessionLoading = vi.fn(async (_params, action) => action());
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: { "thread-1": "codex" },
      runWithCreateSessionLoading,
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up");
    });

    expect(runWithCreateSessionLoading).not.toHaveBeenCalled();
  });

  it("sends follow-up messages on the rewound codex child thread", async () => {
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-codex-rewind-1",
      ensuredThreadId: "thread-codex-rewind-1",
      threadEngineById: { "thread-codex-rewind-1": "codex" },
      refreshThread,
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up after rewind");
    });

    expect(refreshThread).not.toHaveBeenCalled();
    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-codex-rewind-1",
      "follow up after rewind",
      expect.any(Object),
    );
  });

  it("passes selected collaboration mode payload through codex send", async () => {
    const { result } = makeThreadMessagingHook("codex");
    const collaborationMode = {
      mode: "plan",
      settings: {
        model: "openai/gpt-5.3-codex",
        reasoning_effort: "medium",
      },
    };

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
        [],
        { collaborationMode },
      );
    });

    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "hello codex",
      expect.objectContaining({
        collaborationMode: expect.objectContaining({
          mode: "plan",
        }),
      }),
    );
  });

  it("retries codex send on refreshed thread when backend rejects legacy thread id", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message:
            "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `r` at 1",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-1" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-1");
    const startThreadForWorkspace = vi.fn(async () => "thread-rebound-1");
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        1,
        "ws-1",
        "legacy-thread-id",
        "hello codex",
        expect.any(Object),
      );
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-1",
        "hello codex",
        expect.any(Object),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setThreadItems",
          threadId: "legacy-thread-id",
        }),
      );
    });
  });

  it("creates a fresh codex thread when invalid legacy id cannot be refreshed", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message:
            "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `n` at 1",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-new-legacy" } },
      } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
        activate: true,
        engine: "codex",
      });
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-new-1",
        "hello codex",
        expect.any(Object),
      );
      expect(pushThreadErrorMessage).not.toHaveBeenCalled();
    });
  });

  it("does not fresh-replace a durable codex thread when invalid thread id cannot be refreshed", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message:
          "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `d` at 1",
      },
    } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-should-not-start");
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "durable-thread-id",
      ensuredThreadId: "durable-thread-id",
      startThreadForWorkspace,
      refreshThread,
      itemsByThread: {
        "durable-thread-id": [
          {
            id: "user-durable-before-invalid-id",
            kind: "message",
            role: "user",
            text: "accepted earlier",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up after invalid id");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "durable-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "durable-thread-id",
        expect.any(String),
      );
    });
  });

  it("does not silently replace a stale codex thread when durable local activity exists", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-new-unknown");
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      itemsByThread: {
        "legacy-thread-id": [
          {
            id: "user-accepted-earlier",
            kind: "message",
            role: "user",
            text: "accepted earlier",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "legacy-thread-id",
        expect.any(String),
      );
    });
  });

  it("does not fresh-replace an empty local codex draft when the native thread is missing", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-fresh-local-draft");
    const dispatch = vi.fn();
    const { result, recordThreadActivity, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setActiveThreadId",
          threadId: "thread-fresh-local-draft",
        }),
      );
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "legacy-thread-id",
        expect.any(String),
      );
      expect(recordThreadActivity).not.toHaveBeenCalledWith(
        "ws-1",
        "legacy-thread-id",
        expect.any(Number),
      );
    });
  });

  it("does not fresh-replace a native Codex thread when refresh throws before rebind", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => {
      throw new Error("thread not found: legacy-thread-id");
    });
    const startThreadForWorkspace = vi.fn(async () => "thread-fresh-refresh-throw");
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage, onDebug } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      dispatch,
      codexAcceptedTurnByThread: {
        "legacy-thread-id": {
          fact: "empty-draft",
          source: "thread-start",
          updatedAt: 1,
        },
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setActiveThreadId",
          threadId: "thread-fresh-refresh-throw",
        }),
      );
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "legacy-thread-id",
        expect.any(String),
      );
      expect(onDebug).not.toHaveBeenCalledWith(
        expect.objectContaining({ label: "turn/start draft fresh fallback" }),
      );
    });
  });

  it("does not fresh-replace a durable stale codex thread when refresh throws", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: durable-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => {
      throw new Error("thread not found: durable-thread-id");
    });
    const startThreadForWorkspace = vi.fn(async () => "thread-should-not-start");
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "durable-thread-id",
      ensuredThreadId: "durable-thread-id",
      startThreadForWorkspace,
      refreshThread,
      itemsByThread: {
        "durable-thread-id": [
          {
            id: "assistant-durable-earlier",
            kind: "message",
            role: "assistant",
            text: "durable answer",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "durable-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "durable-thread-id",
        expect.any(String),
      );
    });
  });

  it("does not fresh-replace a thread-start Codex draft that cannot be rebound", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => null);
    const forkThreadForWorkspace = vi.fn(async () => "thread-fork-should-not-use");
    const startThreadForWorkspace = vi.fn(async () => "thread-fresh-draft");
    const dispatch = vi.fn();
    const { result, recordThreadActivity, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      forkThreadForWorkspace,
      dispatch,
      codexAcceptedTurnByThread: {
        "legacy-thread-id": {
          fact: "empty-draft",
          source: "thread-start",
          updatedAt: 1,
        },
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(forkThreadForWorkspace).not.toHaveBeenCalled();
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setActiveThreadId",
          threadId: "thread-fresh-draft",
        }),
      );
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "legacy-thread-id",
        expect.any(String),
      );
      expect(recordThreadActivity).not.toHaveBeenCalledWith(
        "ws-1",
        "legacy-thread-id",
        expect.any(Number),
      );
    });
  });

  it("does not create a second Codex thread when newly started draft refreshes to the same missing thread", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => "legacy-thread-id");
    const forkThreadForWorkspace = vi.fn(async () => "thread-fork-should-not-use");
    const startThreadForWorkspace = vi.fn().mockResolvedValueOnce("legacy-thread-id");
    const dispatch = vi.fn();
    const { result, recordThreadActivity, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      forkThreadForWorkspace,
      dispatch,
      codexAcceptedTurnByThread: {
        "legacy-thread-id": {
          fact: "empty-draft",
          source: "thread-start",
          updatedAt: 1,
        },
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(forkThreadForWorkspace).not.toHaveBeenCalled();
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        1,
        "ws-1",
        "legacy-thread-id",
        "hello codex",
        expect.any(Object),
      );
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setActiveThreadId",
          threadId: "thread-fresh-after-same-id",
        }),
      );
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "legacy-thread-id",
        expect.any(String),
      );
      expect(recordThreadActivity).not.toHaveBeenCalledWith(
        "ws-1",
        "legacy-thread-id",
        expect.any(Number),
      );
    });
  });

  it("mirrors codex turn-start rpc failures into runtime notices", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        type: "invalid_request_error",
        message:
          "The 'demo' model is not supported when using Codex with a ChatGPT account.",
      },
    } as never);
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "thread-1",
        "会话启动失败：The 'demo' model is not supported when using Codex with a ChatGPT account.",
      );
      expect(getGlobalRuntimeNoticesSnapshot()).toEqual([
        expect.objectContaining({
          severity: "error",
          category: "user-action-error",
          messageKey: "runtimeNotice.error.threadTurnFailed",
          messageParams: {
            engine: "Codex",
            message:
              "The 'demo' model is not supported when using Codex with a ChatGPT account.",
          },
        }),
      ]);
    });
  });

  it("mirrors classified runtime-ended failures with reconnect action context", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled.",
      },
    } as never);
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(getGlobalRuntimeNoticesSnapshot()).toEqual([
        expect.objectContaining({
          severity: "error",
          category: "user-action-error",
          messageKey: "runtimeNotice.error.codexSessionRecoverableFailure",
          messageParams: {
            engine: "Codex",
            rawMessage:
              "[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled.",
            reasonCode: "runtime-ended",
            userAction: "reconnect",
            actionHint: "Reconnect the runtime and retry.",
          },
        }),
      ]);
    });
  });

  it("marks codex thread as accepted after turn start response", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      result: { turn: { id: "turn-accepted" } },
    } as never);
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("codex", { dispatch });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "markCodexAcceptedTurn",
          threadId: "thread-1",
          fact: "accepted",
          source: "turn-start-response",
          timestamp: expect.any(Number),
        }),
      );
    });
  });

  it("retries codex send once when stale thread reports thread not found", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message: "thread not found: legacy-thread-id",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-thread-not-found" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-2");
    const dispatch = vi.fn();
    const { result, onDebug } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-2",
        "hello codex",
        expect.any(Object),
      );
      const reboundUserBubbleActions = dispatch.mock.calls.filter(
        ([action]) =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          (action as { type?: string }).type === "upsertItem" &&
          "threadId" in action &&
          (action as { threadId?: string }).threadId === "thread-rebound-2" &&
          "item" in action &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.kind ===
            "message" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.role ===
            "user" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.text ===
            "hello codex",
      );
      expect(reboundUserBubbleActions).toHaveLength(1);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setThreadItems",
          threadId: "legacy-thread-id",
        }),
      );
      expect(onDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "turn/start thread rebind retry",
          payload: expect.objectContaining({
            reasonCode: "stale-thread-binding",
            staleReason: "thread-not-found",
            retryable: true,
            userAction: "recover-thread",
            outcome: "rebound",
          }),
        }),
      );
    });
  });

  it("retries codex send once when stale thread reports conversation not found", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message: "conversation not found: legacy-thread-id",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-conversation-not-found" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-conversation");
    const dispatch = vi.fn();
    const { result, onDebug } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-conversation",
        "hello codex",
        expect.any(Object),
      );
      expect(onDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "turn/start thread rebind retry",
          payload: expect.objectContaining({
            reasonCode: "stale-thread-binding",
            staleReason: "thread-not-found",
            retryable: true,
            userAction: "recover-thread",
            outcome: "rebound",
          }),
        }),
      );
    });
  });

  it("forks a stale codex thread before falling back to a fresh continuation", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message: "thread not found: legacy-thread-id",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-forked-thread-not-found" } },
      } as never);
    const refreshThread = vi.fn(async () => null);
    const forkThreadForWorkspace = vi.fn(async () => "thread-forked-1");
    const startThreadForWorkspace = vi.fn(async () => "thread-fresh-should-not-start");
    const dispatch = vi.fn();
    const { result, onDebug } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      refreshThread,
      forkThreadForWorkspace,
      startThreadForWorkspace,
      dispatch,
      itemsByThread: {
        "legacy-thread-id": [
          {
            id: "assistant-durable-earlier",
            kind: "message",
            role: "assistant",
            text: "durable answer",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(forkThreadForWorkspace).toHaveBeenCalledWith("ws-1", "legacy-thread-id", {
        activate: true,
      });
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-forked-1",
        "hello codex",
        expect.any(Object),
      );
      expect(dispatch).toHaveBeenCalledWith({
        type: "setActiveThreadId",
        workspaceId: "ws-1",
        threadId: "thread-forked-1",
      });
      expect(onDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "turn/start stale fork continuation",
          payload: expect.objectContaining({
            forkedThreadId: "thread-forked-1",
            reasonCode: "stale-thread-binding",
            staleReason: "thread-not-found",
            userAction: "start-fresh-thread",
          }),
        }),
      );
    });
  });

  it("retries codex send once when stale thread throws session not found", async () => {
    vi.mocked(sendUserMessage)
      .mockRejectedValueOnce(new Error("[SESSION_NOT_FOUND] session file not found"))
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-session-not-found" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-3");
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-3",
        "hello codex",
        expect.any(Object),
      );
      expect(pushThreadErrorMessage).not.toHaveBeenCalled();
      const reboundUserBubbleActions = dispatch.mock.calls.filter(
        ([action]) =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          (action as { type?: string }).type === "upsertItem" &&
          "threadId" in action &&
          (action as { threadId?: string }).threadId === "thread-rebound-3" &&
          "item" in action &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.kind ===
            "message" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.role ===
            "user" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.text ===
            "hello codex",
      );
      expect(reboundUserBubbleActions).toHaveLength(1);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setThreadItems",
          threadId: "legacy-thread-id",
        }),
      );
    });
  });

  it("retries codex send once when refresh returns the same thread id", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message:
            "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `r` at 1",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-retry-same-id" } },
      } as never);
    const refreshThread = vi.fn(async () => "legacy-thread-id");
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "legacy-thread-id",
        "hello codex",
        expect.any(Object),
      );
      const optimisticUserBubbleIds = new Set(
        dispatch.mock.calls
          .filter(
            ([action]) =>
              action &&
              typeof action === "object" &&
              "type" in action &&
              (action as { type?: string }).type === "upsertItem" &&
              "item" in action &&
              (action as {
                item?: { kind?: string; role?: string; text?: string };
              }).item?.kind === "message" &&
              (action as {
                item?: { kind?: string; role?: string; text?: string };
              }).item?.role === "user" &&
              (action as {
                item?: { kind?: string; role?: string; text?: string };
              }).item?.text === "hello codex",
          )
          .map(
            ([action]) =>
              (action as { item: { id: string } }).item.id,
          ),
      );
      expect(optimisticUserBubbleIds.size).toBe(1);
    });
  });

  it("does not attach selectedAgentIcon when sending without selected agent", async () => {
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("codex", { dispatch });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    const optimisticCall = dispatch.mock.calls.find(
      ([action]) =>
        action &&
        typeof action === "object" &&
        "type" in action &&
        (action as { type?: string }).type === "upsertItem" &&
        "item" in action &&
        (action as { item?: { kind?: string; role?: string } }).item?.kind === "message" &&
        (action as { item?: { kind?: string; role?: string } }).item?.role === "user",
    );
    expect(optimisticCall).toBeDefined();
    const optimisticAction = optimisticCall?.[0] as {
      item?: { selectedAgentName?: string | null; selectedAgentIcon?: string | null };
    };
    expect(optimisticAction.item?.selectedAgentName ?? null).toBeNull();
    expect(optimisticAction.item?.selectedAgentIcon ?? null).toBeNull();
  });

  it("injects selected agent name marker into codex prompt block", async () => {
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "请继续",
        [],
        {
          selectedAgent: {
            id: "agent-backend-1",
            name: "后端架构师",
            prompt: "你是一位资深后端架构师，擅长服务治理和高并发设计。",
            icon: "agent-robot-03",
          },
        },
      );
    });

    const calls = vi.mocked(sendUserMessage).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const latestCall = calls[calls.length - 1];
    const sentText = String(latestCall?.[2] ?? "");
    expect(sentText).toContain("## Agent Role and Instructions");
    expect(sentText).toContain("Agent Name: 后端架构师");
    expect(sentText).toContain("Agent Icon: agent-robot-03");
    expect(sentText).toContain("你是一位资深后端架构师，擅长服务治理和高并发设计。");
  });

  it("resolves and injects a built-in agent prompt only at send time", async () => {
    vi.mocked(resolveEnabledBuiltInAgent).mockResolvedValueOnce({
      id: "agency-agents:engineering/engineering-ai-engineer",
      providerId: "agency-agents",
      sourceRevision: "revision-2",
      promptHash: "hash-2",
      prompt: "只在发送时解析的内置提示词。",
    });
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "请继续",
        [],
        {
          selectedAgent: {
            id: "agency-agents:engineering/engineering-ai-engineer",
            name: "AI 工程师",
            source: "builtIn",
            prompt: null,
          },
        },
      );
    });

    expect(resolveEnabledBuiltInAgent).toHaveBeenCalledWith(
      "agency-agents:engineering/engineering-ai-engineer",
    );
    const sentText = String(vi.mocked(sendUserMessage).mock.calls.at(-1)?.[2] ?? "");
    expect(sentText).toContain("## Agent Role and Instructions");
    expect(sentText).toContain("只在发送时解析的内置提示词。");
  });

  it("sends without stale prompt when a selected built-in agent is disabled", async () => {
    vi.mocked(resolveEnabledBuiltInAgent).mockRejectedValueOnce(
      new Error("built-in agent is disabled"),
    );
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "只发送这句话",
        [],
        {
          selectedAgent: {
            id: "agency-agents:design/design-ui-designer",
            name: "UI 设计师",
            source: "builtIn",
            prompt: "不应注入的旧提示词",
          },
        },
      );
    });

    const sentText = String(vi.mocked(sendUserMessage).mock.calls.at(-1)?.[2] ?? "");
    expect(sentText).not.toContain("## Agent Role and Instructions");
    expect(sentText).not.toContain("不应注入的旧提示词");
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.any(String),
        message: expect.any(String),
      }),
    );
  });

  it("releases codex processing state when first packet timeout is recoverable", async () => {
    vi.mocked(sendUserMessage).mockRejectedValueOnce(
      new Error(
        "FIRST_PACKET_TIMEOUT:35:Timed out waiting for initial response. Network, proxy, or upstream service load may be causing delay. Please retry.",
      ),
    );
    const { result, markProcessing, setActiveTurnId, pushThreadErrorMessage } =
      makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
      );
    });

    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "thread-1",
      "threads.firstPacketTimeout",
    );
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.firstPacketTimeout",
      }),
    );
  });

  it("releases codex processing state when first packet timeout comes back as rpc error", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message:
          "FIRST_PACKET_TIMEOUT:20:Timed out waiting for initial response. Network, proxy, or upstream service load may be causing delay. Please retry.",
      },
    });
    const { result, markProcessing, setActiveTurnId, pushThreadErrorMessage } =
      makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
      );
    });

    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "thread-1",
      "threads.firstPacketTimeout",
    );
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.firstPacketTimeout",
      }),
    );
  });

});
