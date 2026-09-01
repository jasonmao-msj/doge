import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event, EventCallback, UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import type { AppServerEvent } from "../types";
import { dispatchAppServerEvent } from "../features/app/hooks/useAppServerEvents";
import {
  getAppServerEventBackpressureForTests,
  resetAppServerEventBackpressureForTests,
  subscribeAppServerEvents,
  subscribeCliInstallerEvents,
  subscribeMenuCycleCollaborationMode,
  subscribeMenuCycleModel,
  subscribeMenuNewAgent,
  subscribeNativeProviderContinuationProgress,
  subscribeRuntimeLogStatus,
  subscribeTerminalOutput,
  subscribeWechatSessionUpdated,
} from "./events";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("events subscriptions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    resetAppServerEventBackpressureForTests();
  });

  it("delivers payloads and unsubscribes on cleanup", async () => {
    const listeners = new Map<string, EventCallback<unknown>>();
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((eventName, handler) => {
      listeners.set(String(eventName), handler as EventCallback<unknown>);
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeAppServerEvents(onEvent);
    const payload: AppServerEvent = {
      workspace_id: "ws-1",
      message: { method: "ping" },
    };

    const event: Event<AppServerEvent> = {
      event: "app-server-event",
      id: 1,
      payload,
    };
    listeners.get("app-server-event")?.(event);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onEvent).toHaveBeenCalledWith(payload);

    cleanup();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("delivers canonical WeChat session updates", async () => {
    const listeners = new Map<string, EventCallback<unknown>>();
    const unlisten = vi.fn();
    vi.mocked(listen).mockImplementation((eventName, handler) => {
      listeners.set(String(eventName), handler as EventCallback<unknown>);
      return Promise.resolve(unlisten);
    });
    const onEvent = vi.fn();
    const cleanup = subscribeWechatSessionUpdated(onEvent);
    const payload = {
      workspaceId: "workspace-a",
      sessionId: "native-thread-a",
      engine: "codex" as const,
      model: "gpt-5.6-sol",
    };

    listeners.get("wechat://session-updated")?.({
      event: "wechat://session-updated",
      id: 10,
      payload,
    });

    expect(onEvent).toHaveBeenCalledWith(payload);
    cleanup();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("fans out app-server-event-batch predecessors before terminal settlement", async () => {
    const listeners = new Map<string, EventCallback<unknown>>();
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((eventName, handler) => {
      listeners.set(String(eventName), handler as EventCallback<unknown>);
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeAppServerEvents(onEvent);
    const first: AppServerEvent = {
      workspace_id: "ws-1",
      message: { method: "thread/tokenUsage/updated", params: { threadId: "t1" } },
    };
    const second: AppServerEvent = {
      workspace_id: "ws-1",
      message: { method: "turn/completed", params: { threadId: "t1" } },
    };

    listeners.get("app-server-event-batch")?.({
      event: "app-server-event-batch",
      id: 2,
      payload: [first, second],
    });

    expect(onEvent).toHaveBeenNthCalledWith(1, first);
    expect(onEvent).toHaveBeenNthCalledWith(2, second);

    cleanup();
  });

  it("preserves single-channel source order through terminal settlement", () => {
    const listeners = new Map<string, EventCallback<unknown>>();
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((eventName, handler) => {
      listeners.set(String(eventName), handler as EventCallback<unknown>);
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeAppServerEvents(onEvent);
    const delta: AppServerEvent = {
      workspace_id: "ws-single",
      message: {
        method: "item/agentMessage/delta",
        params: { threadId: "t-single", itemId: "item-single", delta: "done" },
      },
    };
    const completed: AppServerEvent = {
      workspace_id: "ws-single",
      message: {
        method: "item/completed",
        params: {
          threadId: "t-single",
          item: { id: "item-single", type: "agentMessage", text: "done" },
        },
      },
    };
    const terminal: AppServerEvent = {
      workspace_id: "ws-single",
      message: {
        method: "turn/completed",
        params: { threadId: "t-single", turnId: "turn-single" },
      },
    };

    for (const payload of [delta, completed, terminal]) {
      listeners.get("app-server-event")?.({
        event: "app-server-event",
        id: 3,
        payload,
      });
    }

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      delta,
      completed,
      terminal,
    ]);
    cleanup();
  });

  it("keeps unrelated workspace events queued when a terminal barrier arrives", async () => {
    const listeners = new Map<string, EventCallback<unknown>>();
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((eventName, handler) => {
      listeners.set(String(eventName), handler as EventCallback<unknown>);
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeAppServerEvents(onEvent);
    const workspaceA: AppServerEvent = {
      workspace_id: "ws-a",
      message: { method: "item/completed", params: { threadId: "t-a" } },
    };
    const workspaceB: AppServerEvent = {
      workspace_id: "ws-b",
      message: { method: "item/completed", params: { threadId: "t-b" } },
    };
    const terminalA: AppServerEvent = {
      workspace_id: "ws-a",
      message: { method: "turn/completed", params: { threadId: "t-a" } },
    };

    listeners.get("app-server-event-batch")?.({
      event: "app-server-event-batch",
      id: 3,
      payload: [workspaceA, workspaceB, terminalA],
    });

    expect(onEvent).toHaveBeenNthCalledWith(1, workspaceA);
    expect(onEvent).toHaveBeenNthCalledWith(2, terminalA);
    expect(onEvent).not.toHaveBeenCalledWith(workspaceB);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onEvent).toHaveBeenNthCalledWith(3, workspaceB);

    cleanup();
  });

  it("dispatches Shared projected final content before terminal settlement", () => {
    const listeners = new Map<string, EventCallback<unknown>>();
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((eventName, handler) => {
      listeners.set(String(eventName), handler as EventCallback<unknown>);
      return Promise.resolve(unlisten);
    });

    const dispatched: string[] = [];
    const sharedOwner = {
      sharedSessionId: "shared-session-order",
      sharedThreadId: "shared:thread-order",
      nativeThreadId: "native-thread-order",
      runtimeTurnId: "turn-order",
      attemptId: "attempt-order",
      engine: "codex",
    };
    const cleanup = subscribeAppServerEvents((event) => {
      dispatchAppServerEvent(
        {
          onAgentMessageDelta: () => dispatched.push("delta"),
          onAgentMessageCompleted: () => dispatched.push("item/completed"),
          onTurnCompleted: () => dispatched.push("turn/completed"),
        },
        event,
        {
          useNormalizedRealtimeAdapters: false,
          threadAgentDeltaSeenRef: { current: {} },
          threadAgentCompletedSeenRef: { current: {} },
          threadAgentSnapshotSeenRef: { current: {} },
        },
      );
    });

    const events: AppServerEvent[] = [
      {
        workspace_id: "ws-shared-order",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "shared:thread-order",
            nativeThreadId: "native-thread-order",
            turnId: "turn-order",
            itemId: "assistant-order",
            delta: "final text",
            sharedOwner,
          },
        },
      },
      {
        workspace_id: "ws-shared-order",
        message: {
          method: "item/completed",
          params: {
            threadId: "shared:thread-order",
            nativeThreadId: "native-thread-order",
            turnId: "turn-order",
            item: {
              id: "assistant-order",
              type: "agentMessage",
              text: "final text",
            },
            sharedOwner,
          },
        },
      },
      {
        workspace_id: "ws-shared-order",
        message: {
          method: "turn/completed",
          params: {
            threadId: "shared:thread-order",
            nativeThreadId: "native-thread-order",
            turnId: "turn-order",
            sharedOwner,
          },
        },
      },
    ];

    listeners.get("app-server-event-batch")?.({
      event: "app-server-event-batch",
      id: 4,
      payload: events,
    });

    expect(dispatched).toEqual([
      "delta",
      "item/completed",
      "turn/completed",
    ]);
    cleanup();
  });

  it("bounds app-server raw diagnostics retention to 128 events", () => {
    const backpressure = getAppServerEventBackpressureForTests();
    for (let i = 0; i < 200; i++) {
      backpressure.push({
        workspace_id: "ws-1",
        message: { method: "processing/heartbeat", params: { threadId: `t-${i}` } },
      });
    }

    expect(backpressure.getStats().rawRetainedCount).toBe(128);
    expect(backpressure.getRawRecent()).toHaveLength(128);
  });

  it("coalesces superseding item/updated snapshots for the same item", () => {
    const backpressure = getAppServerEventBackpressureForTests();
    const snapshot = (text: string): AppServerEvent => ({
      workspace_id: "ws-1",
      message: {
        method: "item/updated",
        params: {
          threadId: "t1",
          item: { id: "item-1", kind: "message", text },
        },
      },
    });

    backpressure.push(snapshot("hel"));
    backpressure.push(snapshot("hello"));
    backpressure.push(snapshot("hello wor"));

    expect(backpressure.queueDepth).toBe(1);
    expect(backpressure.coalescedCount).toBe(2);
  });

  it("does not coalesce item/updated events for different items", () => {
    const backpressure = getAppServerEventBackpressureForTests();
    const snapshot = (itemId: string): AppServerEvent => ({
      workspace_id: "ws-1",
      message: {
        method: "item/updated",
        params: {
          threadId: "t1",
          item: { id: itemId, kind: "message", text: "hi" },
        },
      },
    });

    backpressure.push(snapshot("item-1"));
    backpressure.push(snapshot("item-2"));

    expect(backpressure.queueDepth).toBe(2);
    expect(backpressure.coalescedCount).toBe(0);
  });

  it("cleans up listeners that resolve after unsubscribe", async () => {
    let resolveListener: (handler: UnlistenFn) => void = () => {};
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation(
      () =>
        new Promise<UnlistenFn>((resolve) => {
          resolveListener = resolve;
        }),
    );

    const cleanup = subscribeMenuNewAgent(() => {});
    cleanup();

    resolveListener(unlisten);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("delivers menu events to subscribers", async () => {
    let listener: EventCallback<void> = () => {};
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((_event, handler) => {
      listener = handler as EventCallback<void>;
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeMenuCycleModel(onEvent);

    const event: Event<void> = {
      event: "menu-composer-cycle-model",
      id: 1,
      payload: undefined,
    };
    listener(event);
    expect(onEvent).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("delivers CLI installer progress events to subscribers", async () => {
    let listener: EventCallback<any> = () => {};
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((_event, handler) => {
      listener = handler as EventCallback<any>;
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeCliInstallerEvents(onEvent);
    const payload = {
      runId: "run-1",
      engine: "claude",
      action: "installLatest",
      strategy: "npmGlobal",
      backend: "local",
      phase: "stdout",
      stream: "stdout",
      message: "added 1 package",
      exitCode: null,
      durationMs: null,
    };

    listener({
      event: "cli-installer-event",
      id: 1,
      payload,
    });
    expect(onEvent).toHaveBeenCalledWith(payload);

    cleanup();
  });

  it("delivers native Provider continuation progress events", () => {
    let listener: EventCallback<any> = () => {};
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((_event, handler) => {
      listener = handler as EventCallback<any>;
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeNativeProviderContinuationProgress(onEvent);
    const payload = {
      workspaceId: "ws-1",
      operationId: "operation-1",
      phase: "delivering-context",
      percent: 68,
    };

    listener({
      event: "native-provider-continuation-progress",
      id: 1,
      payload,
    });
    expect(onEvent).toHaveBeenCalledWith(payload);

    cleanup();
  });

  it("delivers collaboration cycle menu events to subscribers", async () => {
    let listener: EventCallback<void> = () => {};
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((_event, handler) => {
      listener = handler as EventCallback<void>;
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeMenuCycleCollaborationMode(onEvent);

    const event: Event<void> = {
      event: "menu-composer-cycle-collaboration",
      id: 1,
      payload: undefined,
    };
    listener(event);
    expect(onEvent).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("reports listen errors through options", async () => {
    const error = new Error("nope");
    vi.mocked(listen).mockRejectedValueOnce(error);

    const onError = vi.fn();
    const cleanup = subscribeTerminalOutput(() => {}, { onError });

    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);

    cleanup();
  });

  it("batches terminal output until the frame-budget flush", async () => {
    let listener: EventCallback<any> = () => {};
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((_event, handler) => {
      listener = handler as EventCallback<any>;
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeTerminalOutput(onEvent);
    listener({
      event: "terminal-output",
      id: 1,
      payload: { workspaceId: "ws-1", terminalId: "term-1", data: "secret output" },
    });

    expect(onEvent).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onEvent).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      terminalId: "term-1",
      data: "secret output",
    });

    cleanup();
  });

  it("delivers critical runtime status without waiting for the queue flush", async () => {
    let listener: EventCallback<any> = () => {};
    const unlisten = vi.fn();

    vi.mocked(listen).mockImplementation((_event, handler) => {
      listener = handler as EventCallback<any>;
      return Promise.resolve(unlisten);
    });

    const onEvent = vi.fn();
    const cleanup = subscribeRuntimeLogStatus(onEvent);
    const payload = {
      workspaceId: "ws-1",
      terminalId: "runtime",
      status: "stopped",
      commandPreview: null,
      startedAtMs: null,
      stoppedAtMs: 10,
      exitCode: 0,
      error: null,
    };

    listener({
      event: "runtime-log:status-changed",
      id: 1,
      payload,
    });

    expect(onEvent).toHaveBeenCalledWith(payload);
    cleanup();
  });
});
