// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent, DebugEntry } from "../../../types";
import { handleThreadAppServerEventDiagnostics } from "./threadAppServerEventDiagnostics";

function emitDiagnostics(event: AppServerEvent): DebugEntry[] {
  const entries: DebugEntry[] = [];
  handleThreadAppServerEventDiagnostics({
    event,
    onDebug: (entry) => entries.push(entry),
    getThreadLifecycleSnapshot: () => ({
      isProcessing: false,
      activeTurnId: null,
    }),
    getExpectedTurnId: () => null,
    emitForegroundSettlementDiagnostic: vi.fn(),
    noteCodexTurnProgressEvidence: vi.fn(),
  });
  return entries;
}

describe("threadAppServerEventDiagnostics stderr privacy", () => {
  beforeEach(() => {
    window.localStorage.setItem("doge.debug.reasoning.raw", "1");
  });

  it("classifies the known model refresh timeout in the durable semantic entry", () => {
    const rawMessage =
      "WARN codex_models_manager refresh failed: timed out waiting for child process to exit";
    const entries = emitDiagnostics({
      workspace_id: "workspace-1",
      message: {
        method: "codex/stderr",
        params: {
          message: rawMessage,
          threadId: "thread-1",
          turnId: "turn-1",
        },
      },
    });

    const semanticEntry = entries.find(
      (entry) => entry.label === "codex/stderr",
    );
    expect(semanticEntry).toMatchObject({
      source: "stderr",
      payload: {
        workspaceId: "workspace-1",
        threadId: "thread-1",
        turnId: "turn-1",
        reasonCode: "codex-model-refresh-child-exit-timeout",
        redactedText: true,
        rawMessageLength: rawMessage.length,
      },
    });
    expect(JSON.stringify(semanticEntry)).not.toContain("waiting for child");
  });

  it("keeps unknown raw stderr only in the Debug-panel entry", () => {
    const rawMessage = "private command output with token sk-secret";
    const entries = emitDiagnostics({
      workspace_id: "workspace-1",
      message: {
        method: "codex/stderr",
        params: { message: rawMessage },
      },
    });

    const semanticEntry = entries.find(
      (entry) => entry.label === "codex/stderr",
    );
    expect(semanticEntry).toMatchObject({
      source: "stderr",
      payload: {
        reasonCode: "unclassified-stderr",
        redactedText: true,
        rawMessageLength: rawMessage.length,
      },
    });
    expect(JSON.stringify(semanticEntry)).not.toContain("sk-secret");

    expect(entries.find((entry) => entry.label === "stderr/raw")).toMatchObject(
      {
        source: "event",
        payload: rawMessage,
      },
    );
  });
});
