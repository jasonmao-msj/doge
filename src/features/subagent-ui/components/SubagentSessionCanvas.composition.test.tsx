// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

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
const canvasSnapshot = vi.hoisted(() => ({
  items: [],
  threadId: "parent-thread",
  threadItemsByThread: {
    "claude:child-thread": [
      {
        id: "assistant-1",
        kind: "message" as const,
        role: "assistant" as const,
        text: "done",
      },
    ],
  },
  workspaceId: "workspace-1",
  workspacePath: "/workspace",
}));

vi.mock("../../messages", () => ({
  Messages: (props: Record<string, unknown>) => {
    messagesCapture.props = props;
    return <div data-testid="messages" />;
  },
}));

vi.mock("../../layout/hooks/activeCanvasStore", () => ({
  EMPTY_ACTIVE_CANVAS_ITEMS: [],
  useActiveCanvasSelector: (selector: (snapshot: typeof canvasSnapshot) => unknown) =>
    selector(canvasSnapshot),
}));

vi.mock("../hooks/useSubagentInspectorStore", () => ({
  useSubagentInspectorSelection: () => null,
}));

vi.mock("../hooks/useSubagentSessionProbeStore", () => ({
  publishSubagentSessionProbe: vi.fn(),
}));

vi.mock("../../threads/hooks/useThreadActions.historyLoaderFactory", () => ({
  createThreadHistoryLoaderForThread: vi.fn(),
}));

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

import { SubagentSessionCanvas } from "./SubagentSessionCanvas";

afterEach(() => {
  cleanup();
  messagesCapture.props = null;
  promptDistillation.start.mockClear();
});

describe("SubagentSessionCanvas peer composition", () => {
  it("provides Prompt Distill and History Fold integrations to nested Messages", async () => {
    render(<SubagentSessionCanvas sessionThreadId="claude:child-thread" />);

    await waitFor(() => expect(messagesCapture.props).not.toBeNull());

    const onSaveAsPrompt = messagesCapture.props?.onSaveAsPrompt as
      | ((sourceText: string) => void)
      | undefined;
    onSaveAsPrompt?.("distill nested transcript");
    expect(promptDistillation.start).toHaveBeenCalledWith(
      "distill nested transcript",
    );

    const renderHistoryFold = messagesCapture.props?.renderHistoryFold as
      | ((itemId: string) => ReactNode)
      | undefined;
    const slot = renderHistoryFold?.("agent:run-2:hist-fold");
    const renderedSlot = render(<>{slot}</>);
    expect(renderedSlot.getByTestId("history-fold-slot").textContent).toBe(
      "agent:run-2:hist-fold",
    );
  });
});
