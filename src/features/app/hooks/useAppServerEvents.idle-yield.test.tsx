// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent } from "../../../types";
import {
  resetAppServerEventBackpressureForTests,
  subscribeAppServerEvents,
  subscribeRawAppServerEvents,
} from "../../../services/events";
import { useAppServerEvents } from "./useAppServerEvents";

vi.mock("../../../services/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/events")>();
  return {
    ...actual,
    subscribeAppServerEvents: vi.fn(),
    subscribeRawAppServerEvents: vi.fn(),
  };
});

vi.mock("@/conversation-presentation/realtimePerfFlags", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/conversation-presentation/realtimePerfFlags")
    >();
  return {
    ...actual,
    isAppServerEventBatchConsumerEnabled: vi.fn(() => true),
    readStreamingScheduleTier: vi.fn(() => "guarded"),
  };
});

let listener: ((event: AppServerEvent) => void) | null = null;
const unlistenSingle = vi.fn();
const unlistenRaw = vi.fn();

type Handlers = Parameters<typeof useAppServerEvents>[0];

function TestHarness({ handlers }: { handlers: Handlers }) {
  useAppServerEvents(handlers);
  return null;
}

async function mount(handlers: Handlers) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<TestHarness handlers={handlers} />);
  });
  return { root, container };
}

describe("useAppServerEvents v2 (guarded tier) idle-yield path", () => {
  beforeEach(() => {
    listener = null;
    unlistenSingle.mockReset();
    unlistenRaw.mockReset();
    resetAppServerEventBackpressureForTests();
    vi.mocked(subscribeAppServerEvents).mockImplementation((cb) => {
      listener = cb;
      return unlistenSingle;
    });
    vi.mocked(subscribeRawAppServerEvents).mockImplementation(() => {
      return unlistenRaw;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("routes per-event delta events through the scheduler and dispatches each", async () => {
    const onAgentMessageDelta = vi.fn();
    const handlers: Handlers = { onAgentMessageDelta };
    await mount(handlers);

    const events: AppServerEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "item-1", delta: `d${i}` },
        },
      });
    }
    await act(async () => {
      for (const event of events) {
        listener?.(event);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onAgentMessageDelta).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i++) {
      expect(onAgentMessageDelta).toHaveBeenNthCalledWith(i + 1, {
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "item-1",
        delta: `d${i}`,
      });
    }
  });

  it("dispatches critical methods delivered by the per-event bridge", async () => {
    const onTurnCompleted = vi.fn();
    const handlers: Handlers = { onTurnCompleted };
    await mount(handlers);

    const critical: AppServerEvent = {
      workspace_id: "ws-1",
      message: {
        method: "turn/completed",
        params: { threadId: "thread-1", turnId: "turn-1" },
      },
    };
    await act(async () => {
      listener?.(critical);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(onTurnCompleted).toHaveBeenCalledTimes(1);
  });

  it("subscribes to the unified per-event stream on mount", async () => {
    const handlers: Handlers = { onAppServerEvent: vi.fn() };
    const { root } = await mount(handlers);
    expect(vi.mocked(subscribeAppServerEvents)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(subscribeRawAppServerEvents)).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
    expect(unlistenSingle).toHaveBeenCalledTimes(1);
    expect(unlistenRaw).not.toHaveBeenCalled();
  });
});
