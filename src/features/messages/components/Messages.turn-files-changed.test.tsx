// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { Messages } from "./Messages";

vi.mock("./Markdown", () => ({
  Markdown: ({ value, className }: { value: string; className?: string }) => (
    <div className={className}>{value}</div>
  ),
}));

function userMessage(id: string): ConversationItem {
  return { id, kind: "message", role: "user", text: `Q-${id}` };
}

function finalAssistant(id: string): ConversationItem {
  return {
    id,
    kind: "message",
    role: "assistant",
    text: `A-${id}`,
    isFinal: true,
  };
}

function editTool(
  id: string,
  filePath: string,
  oldString: string,
  newString: string,
): ConversationItem {
  return {
    id,
    kind: "tool",
    toolType: "edit",
    title: "Tool: edit",
    detail: JSON.stringify({
      file_path: filePath,
      old_string: oldString,
      new_string: newString,
    }),
    status: "completed",
    output: "ok",
  };
}

function renderMessages(items: ConversationItem[]) {
  return render(
    <Messages
      items={items}
      threadId="thread-1"
      workspaceId="ws-1"
      isThinking={false}
      activeEngine="codex"
      openTargets={[]}
      selectedOpenAppId=""
    />,
  );
}

describe("Messages turn files changed cards", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.setItem("doge.claude.hideReasoningModule", "0");
    window.localStorage.removeItem("doge.messages.live.autoFollow");
    window.localStorage.setItem("doge.messages.live.collapseMiddleSteps", "0");
  });

  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
  });

  it("does not render inline or session file-change cards in the timeline (moved to composer strip)", () => {
    const { container } = renderMessages([
      userMessage("u1"),
      editTool("t1", "src/a.ts", "old", "new\nnew2"),
      finalAssistant("a1"),
      userMessage("u2"),
      editTool("t2", "src/b.ts", "", "one\ntwo"),
      finalAssistant("a2"),
    ]);

    expect(container.querySelectorAll(".turn-files-changed-card")).toHaveLength(0);
    expect(container.querySelector(".messages-session-files-changed")).toBeNull();
  });

  it("still renders no cards when the conversation has no file edits", () => {
    const { container } = renderMessages([
      userMessage("u1"),
      finalAssistant("a1"),
    ]);

    expect(container.querySelectorAll(".turn-files-changed-card")).toHaveLength(0);
    expect(container.querySelector(".messages-session-files-changed")).toBeNull();
  });
});
