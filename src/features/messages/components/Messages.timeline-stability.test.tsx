// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApprovalRequest,
  OpenAppTarget,
  RequestUserInputRequest,
  WorkspaceInfo,
} from "../../../types";
import type { MessagesTimelineProps } from "../orchestration/models/messagesTimelineModels";

const timelineProbe = vi.hoisted(() => ({
  renderCount: 0,
  stableProjectionDerivationCount: 0,
  modelChanges: [] as string[][],
  snapshots: [] as Array<{
    approvalNode: unknown;
    heartbeatPulse: number;
    liveAssistantText: string | null;
    stableProjectionVersion: number;
    userInputNode: unknown;
  }>,
}));

vi.mock("./MessagesTimeline", async () => {
  const React = await import("react");
  return {
    MessagesTimeline: React.memo((props: MessagesTimelineProps) => {
      timelineProbe.renderCount += 1;
      const stableProjectionVersion = React.useMemo(() => {
        void props.snapshot.groupedEntries;
        timelineProbe.stableProjectionDerivationCount += 1;
        return timelineProbe.stableProjectionDerivationCount;
      }, [props.snapshot.groupedEntries]);
      timelineProbe.snapshots.push({
        approvalNode: props.slots.approvalNode,
        heartbeatPulse: props.live.heartbeatPulse,
        liveAssistantText: props.live.liveAssistantItem?.text ?? null,
        stableProjectionVersion,
        userInputNode: props.slots.userInputNode,
      });
      return React.createElement("div", { "data-testid": "messages-timeline-probe" });
    }, (previous, next) => {
      const changedKeys = (Object.keys(previous) as Array<keyof MessagesTimelineProps>)
        .filter((key) => !Object.is(previous[key], next[key]));
      const interactionChanges = changedKeys.includes("interactions")
        ? (Object.keys(previous.interactions) as Array<keyof MessagesTimelineProps["interactions"]>)
            .filter((key) => !Object.is(previous.interactions[key], next.interactions[key]))
            .map((key) => `interactions.${key}`)
        : [];
      timelineProbe.modelChanges.push([...changedKeys, ...interactionChanges]);
      return changedKeys.length === 0;
    }),
  };
});

vi.mock("./Markdown", () => ({
  Markdown: ({ value, className }: { value: string; className?: string }) => (
    <div className={className}>{value}</div>
  ),
}));

import { Messages } from "./Messages";

const EMPTY_APPROVALS: ApprovalRequest[] = [];
const EMPTY_OPEN_TARGETS: OpenAppTarget[] = [];
const EMPTY_USER_INPUT_REQUESTS: RequestUserInputRequest[] = [];
const EMPTY_WORKSPACES: WorkspaceInfo[] = [];

describe("Messages timeline prop stability", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });

  beforeEach(() => {
    timelineProbe.renderCount = 0;
    timelineProbe.stableProjectionDerivationCount = 0;
    timelineProbe.modelChanges = [];
    timelineProbe.snapshots = [];
    window.localStorage.setItem("ccgui.claude.hideReasoningModule", "0");
    window.localStorage.removeItem("ccgui.messages.live.autoFollow");
    window.localStorage.setItem("ccgui.messages.live.collapseMiddleSteps", "0");
  });

  afterEach(() => {
    cleanup();
  });

  it("does not re-render the Codex timeline for an unused heartbeat", () => {
    const items = [
      {
        id: "assistant-final",
        kind: "message" as const,
        role: "assistant" as const,
        text: "稳定快照",
        isFinal: true,
      },
    ];
    const onUserInputSubmit = vi.fn();
    const view = render(
      <Messages
        items={items}
        threadId="thread-codex-heartbeat-gated"
        workspaceId="ws-1"
        isThinking={false}
        heartbeatPulse={1}
        activeEngine="codex"
        approvals={EMPTY_APPROVALS}
        userInputRequests={EMPTY_USER_INPUT_REQUESTS}
        workspaces={EMPTY_WORKSPACES}
        onUserInputSubmit={onUserInputSubmit}
        openTargets={EMPTY_OPEN_TARGETS}
        selectedOpenAppId=""
      />,
    );

    expect(timelineProbe.snapshots.at(-1)).toMatchObject({
      approvalNode: null,
      heartbeatPulse: 0,
      userInputNode: null,
    });
    const renderCountBeforeHeartbeat = timelineProbe.renderCount;

    view.rerender(
      <Messages
        items={items}
        threadId="thread-codex-heartbeat-gated"
        workspaceId="ws-1"
        isThinking={false}
        heartbeatPulse={2}
        activeEngine="codex"
        approvals={EMPTY_APPROVALS}
        userInputRequests={EMPTY_USER_INPUT_REQUESTS}
        workspaces={EMPTY_WORKSPACES}
        onUserInputSubmit={onUserInputSubmit}
        openTargets={EMPTY_OPEN_TARGETS}
        selectedOpenAppId=""
      />,
    );

    expect(timelineProbe.modelChanges.at(-1)).toEqual([]);
    expect(timelineProbe.renderCount).toBe(renderCountBeforeHeartbeat);
    expect(timelineProbe.snapshots.at(-1)?.heartbeatPulse).toBe(0);
  });

  it("keeps heartbeat updates for engines whose waiting indicator consumes them", () => {
    const items = [
      {
        id: "assistant-opencode",
        kind: "message" as const,
        role: "assistant" as const,
        text: "等待输出",
        isFinal: false,
      },
    ];
    const view = render(
      <Messages
        items={items}
        threadId="thread-opencode-heartbeat"
        workspaceId="ws-1"
        isThinking
        heartbeatPulse={1}
        activeEngine="opencode"
        approvals={EMPTY_APPROVALS}
        userInputRequests={EMPTY_USER_INPUT_REQUESTS}
        workspaces={EMPTY_WORKSPACES}
        openTargets={EMPTY_OPEN_TARGETS}
        selectedOpenAppId=""
      />,
    );
    const renderCountBeforeHeartbeat = timelineProbe.renderCount;

    view.rerender(
      <Messages
        items={items}
        threadId="thread-opencode-heartbeat"
        workspaceId="ws-1"
        isThinking
        heartbeatPulse={2}
        activeEngine="opencode"
        approvals={EMPTY_APPROVALS}
        userInputRequests={EMPTY_USER_INPUT_REQUESTS}
        workspaces={EMPTY_WORKSPACES}
        openTargets={EMPTY_OPEN_TARGETS}
        selectedOpenAppId=""
      />,
    );

    expect(timelineProbe.renderCount).toBeGreaterThan(renderCountBeforeHeartbeat);
    expect(timelineProbe.snapshots.at(-1)?.heartbeatPulse).toBe(2);
  });

  it("updates same-item live text and timeline projection in the same render", () => {
    const userItem = {
      id: "user-live-projection",
      kind: "message" as const,
      role: "user" as const,
      text: "继续",
    };
    const assistantItem = {
      id: "assistant-live-projection",
      kind: "message" as const,
      role: "assistant" as const,
      text: "第一段",
      isFinal: false,
    };
    const view = render(
      <Messages
        items={[userItem, assistantItem]}
        threadId="thread-live-projection"
        workspaceId="ws-1"
        isThinking
        activeEngine="codex"
        approvals={EMPTY_APPROVALS}
        userInputRequests={EMPTY_USER_INPUT_REQUESTS}
        workspaces={EMPTY_WORKSPACES}
        openTargets={EMPTY_OPEN_TARGETS}
        selectedOpenAppId=""
      />,
    );
    const stableProjectionVersion =
      timelineProbe.snapshots.at(-1)?.stableProjectionVersion;
    timelineProbe.snapshots = [];

    view.rerender(
      <Messages
        items={[
          userItem,
          {
            ...assistantItem,
            text: "第一段\n\n第二段",
          },
        ]}
        threadId="thread-live-projection"
        workspaceId="ws-1"
        isThinking
        activeEngine="codex"
        approvals={EMPTY_APPROVALS}
        userInputRequests={EMPTY_USER_INPUT_REQUESTS}
        workspaces={EMPTY_WORKSPACES}
        openTargets={EMPTY_OPEN_TARGETS}
        selectedOpenAppId=""
      />,
    );

    expect(
      timelineProbe.snapshots.some(
        (snapshot) =>
          snapshot.liveAssistantText === "第一段\n\n第二段"
          && snapshot.stableProjectionVersion !== stableProjectionVersion,
      ),
    ).toBe(true);
  });
});
