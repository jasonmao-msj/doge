// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const lifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
const messagesCapture = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
const promptDistillation = vi.hoisted(() => ({
  close: vi.fn(),
  content: "",
  distillingEngine: "claude" as const,
  error: null,
  isOpen: false,
  name: "",
  phase: "idle" as const,
  save: vi.fn(async () => true),
  setContent: vi.fn(),
  setName: vi.fn(),
  start: vi.fn(),
}));

vi.mock("../../messages", async () => {
  const React = await import("react");
  return {
    Messages: (props: Record<string, unknown>) => {
      messagesCapture.props = props;
      React.useEffect(() => {
        lifecycle.mounts += 1;
        return () => {
          lifecycle.unmounts += 1;
        };
      }, []);
      return <div data-testid="messages" />;
    },
    MessageForkConfirmDialog: () => null,
  };
});

vi.mock("../../prompt-distill/hooks/usePromptDistillation", () => ({
  usePromptDistillation: () => promptDistillation,
}));

vi.mock("../../prompt-distill/components/PromptDistillDialog", () => ({
  PromptDistillDialog: () => null,
}));

vi.mock("../../multi-agent/components/HistoryFoldCard", () => ({
  MultiAgentHistoryFoldTimelineRow: ({ itemId }: { itemId: string }) => (
    <div data-testid="history-fold-slot">{itemId}</div>
  ),
}));

import { buildConversationCanvasNode } from "./conversationCanvasNode";

afterEach(() => {
  lifecycle.mounts = 0;
  lifecycle.unmounts = 0;
  messagesCapture.props = null;
  promptDistillation.start.mockClear();
});

describe("conversationCanvasNode", () => {
  it("does not remount Canvas when its parent recomputes after a target switch", () => {
    const input = {
      messagesProps: {} as never,
      forkConfirmDialogProps: {} as never,
    };
    const view = render(buildConversationCanvasNode(input));

    // selectedNextTarget 属于 Canvas 外层状态；切换时 layout 会重算 node，
    // 但 ActiveCanvasMessages 的 type/key 必须保持稳定。
    view.rerender(buildConversationCanvasNode({ ...input }));

    expect(lifecycle.mounts).toBe(1);
    expect(lifecycle.unmounts).toBe(0);
  });

  it("composes prompt distill and multi-agent history fold outside Messages", () => {
    const input = {
      messagesProps: {
        workspaceId: "workspace-1",
        threadId: "thread-1",
      } as never,
      forkConfirmDialogProps: {} as never,
    };
    render(buildConversationCanvasNode(input));

    const onSaveAsPrompt = messagesCapture.props?.onSaveAsPrompt as
      | ((sourceText: string) => void)
      | undefined;
    onSaveAsPrompt?.("distill this");
    expect(promptDistillation.start).toHaveBeenCalledWith("distill this");

    const renderHistoryFold = messagesCapture.props?.renderHistoryFold as
      | ((itemId: string) => ReactNode)
      | undefined;
    const slot = renderHistoryFold?.("agent:run-1:hist-fold");
    const renderedSlot = render(<>{slot}</>);
    expect(renderedSlot.getByTestId("history-fold-slot").textContent).toBe(
      "agent:run-1:hist-fold",
    );
  });
});
