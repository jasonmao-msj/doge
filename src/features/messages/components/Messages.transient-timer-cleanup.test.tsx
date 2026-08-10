// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { Messages } from "./Messages";

const appendRendererDiagnosticMock = vi.hoisted(() => vi.fn());

vi.mock("../../../services/rendererDiagnostics", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../services/rendererDiagnostics")>();
  return {
    ...actual,
    appendRendererDiagnostic: appendRendererDiagnosticMock,
  };
});

const baseItem: ConversationItem = {
  id: "user-1",
  kind: "message",
  role: "user",
  text: "hello",
};
const secondUserItem: ConversationItem = {
  id: "user-2",
  kind: "message",
  role: "user",
  text: "again",
};

const baseProps = {
  workspaceId: "ws-1",
  items: [baseItem, secondUserItem],
  plan: null,
  userInputRequests: [],
  heartbeatPulse: 0,
  expandedItems: new Set<string>(),
  toggleExpanded: () => {},
  copiedMessageId: null,
  setCopiedMessageId: () => {},
  onAssistantVisibleTextRender: undefined,
  onShowAllHistoryItems: () => {},
  pendingJumpMessageId: null,
  setPendingJumpMessageId: () => {},
  liveAutoFollowEnabled: true,
  setLiveAutoFollowEnabled: () => {},
  isMacDesktop: false,
  isWindowsDesktop: false,
  showFileLinkMenu: undefined,
  onOpenDiffPath: undefined,
  openTargets: [] as Array<{ id: string; label: string; isPrimary?: boolean; kind: "app" | "command" | "finder"; args: string[] }>,
  selectedOpenAppId: "" as string,
  openFileLink: undefined,
  hiddenClaudeReasoningOnly: false,
};

describe("Messages transient timer cleanup on threadId change", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });
  beforeEach(() => {
    vi.useFakeTimers();
    appendRendererDiagnosticMock.mockClear();
    window.localStorage.removeItem("doge.messages.live.autoFollow");
    window.localStorage.setItem("doge.messages.live.collapseMiddleSteps", "0");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears transient timers and emits a cleanup diagnostic when active threadId changes", () => {
    // 新跟随模型：scroll 资源从 setTimeout throttle 改为 rAF（pin/scroll/wheel），
    // scope 切换时经 cancelAnimationFrame 清理（pin rAF 在挂载后即 pending）。
    const cancelRafSpy = vi.spyOn(window, "cancelAnimationFrame");
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");

    try {
      let nextAnimationFrameId = 1;
      rafSpy.mockImplementation(((_cb: FrameRequestCallback) => {
        return nextAnimationFrameId++ as unknown as number;
      }) as typeof window.requestAnimationFrame);
      const { rerender } = render(
        <Messages {...baseProps} threadId="thread-A" isThinking={false} />,
      );
      rerender(
        <Messages {...baseProps} threadId="thread-B" isThinking={false} />,
      );
      expect(cancelRafSpy).toHaveBeenCalled();
      expect(appendRendererDiagnosticMock).toHaveBeenCalledWith(
        "messages/render-resource-cleanup",
        expect.objectContaining({
          surface: "conversation",
          component: "Messages",
          workspaceId: "ws-1",
          previousThreadId: "thread-A",
          threadId: "thread-B",
          pendingResourceCounts: expect.objectContaining({
            scrollThrottleTimer: expect.any(Number),
            messageNodeCount: expect.any(Number),
          }),
        }),
      );
    } finally {
      rafSpy.mockRestore();
      cancelRafSpy.mockRestore();
    }
  });
});
