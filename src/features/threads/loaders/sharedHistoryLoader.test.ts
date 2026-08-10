// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSharedTargetState,
  resetSharedTargetStoreForTests,
  selectNextTarget,
} from "../../shared-session/target/targetStore";
import { getAgentEvidenceRunId } from "../../multi-agent/store/agentStore";
import { createSharedHistoryLoader } from "./sharedHistoryLoader";

afterEach(() => {
  window.localStorage.clear();
  resetSharedTargetStoreForTests();
  vi.restoreAllMocks();
});

describe("sharedHistoryLoader", () => {
  it("reports restore progress phases for Shared history load", async () => {
    const onProgress = vi.fn();
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        id: "shared-progress-1",
        threadId: "shared:progress-1",
        selectedEngine: "claude",
        items: [
          {
            id: "user-1",
            kind: "message",
            role: "user",
            text: "hello",
          },
        ],
      }),
      loadSharedProjection: vi.fn().mockResolvedValue([
        {
          id: "user-1",
          kind: "message",
          content: { role: "user", text: "hello", engineSource: "claude" },
          fidelity: "canonical",
          checksum: "checksum-user",
        },
      ]),
      onProgress,
    });

    await loader.load("shared:progress-1");

    const phases = onProgress.mock.calls.map((call) => call[0].phase);
    expect(phases).toContain("prepare");
    expect(phases).toContain("session");
    expect(phases).toContain("projection");
    expect(phases).toContain("merge");
    expect(phases).toContain("finalize");
    expect(onProgress.mock.calls.at(-1)?.[0].percent).toBe(100);
  });

  it("restores snapshot items from shared session payload", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        id: "shared-session-1",
        threadId: "shared:shared-session-1",
        selectedEngine: "claude",
        items: [
          {
            id: "user-1",
            kind: "message",
            role: "user",
            text: "Explain this repository",
          },
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "Here is the summary",
            engineSource: "claude",
          },
        ],
      }),
      loadSharedProjection: vi.fn(),
    });

    const snapshot = await loader.load("shared:shared-session-1");

    expect(snapshot.threadId).toBe("shared:shared-session-1");
    expect(snapshot.engine).toBe("claude");
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[1]).toMatchObject({
      kind: "message",
      role: "assistant",
      engineSource: "claude",
    });
  });

  it("normalizes legacy unsupported shared-session engines back to claude", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        id: "shared-session-2",
        threadId: "shared:shared-session-2",
        selectedEngine: "gemini",
        items: [],
      }),
      loadSharedProjection: vi.fn(),
    });

    const snapshot = await loader.load("shared:shared-session-2");

    expect(snapshot.engine).toBe("claude");
    expect(snapshot.meta.engine).toBe("claude");
  });

  it("restores the complete persisted next target without guessing missing fields", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "codex",
        selectedTarget: {
          engine: "codex",
          providerProfileId: "provider-kimi",
          modelCatalogEntryId: "settings-kimi",
          model: "kimi-for-coding",
          reasoning: { effort: "high" },
          providerProfileNameSnapshot: "Kimi Coding",
          providerProfileSource: "managed",
        },
        items: [],
      }),
      loadSharedProjection: vi.fn(),
    });

    await loader.load("shared:target-reload");

    expect(
      getSharedTargetState("ws-1", "shared:target-reload").selectedNextTarget,
    ).toEqual({
      engine: "codex",
      providerProfileId: "provider-kimi",
      modelCatalogEntryId: "settings-kimi",
      model: "kimi-for-coding",
      reasoning: { effort: "high" },
      providerProfileNameSnapshot: "Kimi Coding",
      providerProfileSource: "managed",
    });
  });

  it("clears stale target state when persisted target is incomplete", async () => {
    selectNextTarget("ws-1", "shared:legacy-target", {
      engine: "codex",
      providerProfileId: "stale-provider",
    });
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "claude",
        selectedTarget: { engine: "claude" },
        items: [],
      }),
      loadSharedProjection: vi.fn(),
    });

    await loader.load("shared:legacy-target");

    expect(
      getSharedTargetState("ws-1", "shared:legacy-target").selectedNextTarget,
    ).toBeNull();
  });

  it("clears stale target state when persisted selection source is unknown", async () => {
    selectNextTarget("ws-1", "shared:invalid-source", {
      engine: "claude",
      providerProfileId: "stale-provider",
    });
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "codex",
        selectedTarget: {
          engine: "codex",
          providerProfileId: "provider-openai",
          model: "gpt-5.3-codex-spark",
          providerProfileSource: "future-source",
        },
        items: [],
      }),
      loadSharedProjection: vi.fn(),
    });

    await loader.load("shared:invalid-source");

    expect(
      getSharedTargetState("ws-1", "shared:invalid-source").selectedNextTarget,
    ).toBeNull();
  });

  it("uses the resolved target engine as history authority", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "claude",
        selectedTarget: {
          engine: "codex",
          providerProfileId: "provider-kimi",
          modelCatalogEntryId: "settings-kimi",
          model: "kimi-for-coding",
          providerProfileNameSnapshot: "Kimi Coding",
          providerProfileSource: "managed",
        },
        items: [],
      }),
      loadSharedProjection: vi.fn(),
    });

    const snapshot = await loader.load("shared:target-engine-authority");

    expect(snapshot.engine).toBe("codex");
    expect(snapshot.meta.engine).toBe("codex");
  });

  it("keeps Legacy-only reading behind an explicit negative rollback", async () => {
    window.localStorage.setItem("doge.sharedProjection", "0");
    const loadSharedProjection = vi.fn();
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "claude",
        items: [{ id: "legacy", kind: "message", role: "user", text: "legacy" }],
      }),
      loadSharedProjection,
    });

    const snapshot = await loader.load("shared:session-1");

    expect(loadSharedProjection).not.toHaveBeenCalled();
    expect(snapshot.items[0]).toMatchObject({ id: "legacy", text: "legacy" });
  });

  it("converges canonical identity by default without dropping legacy reasoning", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "codex",
        items: [
          { id: "legacy-user", kind: "message", role: "user", text: "1+1" },
          {
            id: "legacy-reasoning",
            kind: "reasoning",
            summary: "先做加法",
            content: "先做加法",
            engineSource: "codex",
          },
          {
            id: "legacy-assistant",
            kind: "message",
            role: "assistant",
            text: "2",
            engineSource: "codex",
            isFinal: true,
          },
        ],
      }),
      loadSharedProjection: vi.fn().mockResolvedValue([
        {
          id: "projected-user",
          kind: "message",
          content: { role: "user", text: "1+1", engineSource: "codex" },
          fidelity: "canonical",
          checksum: "checksum-user",
        },
        {
          id: "projected-reasoning",
          kind: "reasoning",
          content: {
            summary: "先做加法",
            content: "先做加法",
            engineSource: "codex",
          },
          fidelity: "canonical",
          checksum: "checksum-reasoning",
        },
        {
          id: "projected-assistant",
          kind: "message",
          content: {
            role: "assistant",
            text: "2",
            engineSource: "codex",
            executionTargetSnapshot: {
              engine: "codex",
              providerProfileNameSnapshot: "MiniMax",
              providerProfileSource: "managed",
              model: "MiniMax-M3",
              reasoning: { effort: "high" },
            },
          },
          fidelity: "canonical",
          checksum: "checksum-assistant",
        },
      ]),
    });

    const snapshot = await loader.load("shared:session-1");

    expect(snapshot.items).toHaveLength(3);
    expect(snapshot.items[1]).toMatchObject({
      kind: "reasoning",
      content: "先做加法",
    });
    expect(snapshot.items.filter((item) => item.kind === "reasoning")).toHaveLength(1);
    expect(snapshot.items[2]).toMatchObject({
      kind: "message",
      role: "assistant",
      text: "2",
      executionTargetSnapshot: {
        engine: "codex",
        providerProfileNameSnapshot: "MiniMax",
        model: "MiniMax-M3",
        reasoning: { effort: "high" },
      },
    });
  });

  it("does not let a canonical prefix downgrade the complete Shared snapshot", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "claude",
        items: [
          { id: "legacy-user", kind: "message", role: "user", text: "model?" },
          {
            id: "legacy-assistant",
            kind: "message",
            role: "assistant",
            text: "Claude，Anthropic 出品。这里是完整回答。",
          },
        ],
      }),
      loadSharedProjection: vi.fn().mockResolvedValue([
        {
          id: "canonical-user",
          kind: "message",
          content: { role: "user", text: "model?", engineSource: "claude" },
          fidelity: "canonical",
          checksum: "checksum-user",
        },
        {
          id: "canonical-assistant",
          kind: "message",
          content: {
            role: "assistant",
            text: "Cl",
            engineSource: "claude",
            executionTargetSnapshot: {
              engine: "claude",
              providerProfileNameSnapshot: "Official",
              model: "settings-main",
            },
          },
          fidelity: "canonical",
          checksum: "checksum-assistant",
        },
      ]),
    });

    const snapshot = await loader.load("shared:session-prefix");

    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[1]).toMatchObject({
      id: "canonical-assistant",
      text: "Claude，Anthropic 出品。这里是完整回答。",
      executionTargetSnapshot: {
        engine: "claude",
        providerProfileNameSnapshot: "Official",
        model: "settings-main",
      },
    });
  });

  it("does not let a later presentation shadow downgrade canonical turn provenance", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "codex",
        items: [
          { id: "legacy-user", kind: "message", role: "user", text: "model?" },
          {
            id: "legacy-assistant",
            kind: "message",
            role: "assistant",
            text: "answer",
          },
        ],
      }),
      loadSharedProjection: vi.fn().mockResolvedValue([
        {
          id: "canonical-assistant",
          kind: "message",
          content: {
            role: "assistant",
            text: "answer",
            engineSource: "codex",
            executionTargetSnapshot: {
              engine: "codex",
              providerProfileId: "provider-openai",
              providerProfileNameSnapshot: "OpenAI",
              providerProfileSource: "managed",
              modelCatalogEntryId: "settings-gpt-5",
              model: "gpt-5",
            },
          },
          fidelity: "canonical",
          checksum: "canonical-checksum",
        },
        {
          id: "presentation-assistant",
          kind: "message",
          content: {
            role: "assistant",
            text: "answer",
            engineSource: "codex",
            executionTargetSnapshot: {
              engine: "codex",
              providerProfileId: null,
            },
          },
          fidelity: "presentation-only",
          checksum: "presentation-checksum",
        },
      ]),
    });

    const snapshot = await loader.load("shared:session-shadow-precedence");

    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[1]).toMatchObject({
      kind: "message",
      role: "assistant",
      executionTargetSnapshot: {
        engine: "codex",
        providerProfileId: "provider-openai",
        providerProfileNameSnapshot: "OpenAI",
        providerProfileSource: "managed",
        model: "gpt-5",
      },
    });
  });

  it("falls back observably to V0 when projection loading fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "claude",
        items: [{ id: "legacy", kind: "message", role: "user", text: "legacy" }],
      }),
      loadSharedProjection: vi.fn().mockRejectedValue(new Error("projection unavailable")),
    });

    const snapshot = await loader.load("shared:session-1");

    expect(snapshot.items[0]).toMatchObject({ id: "legacy" });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("propagates projection failure when no legacy snapshot can preserve history", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const projectionError = new Error("canonical projection unavailable");
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "claude",
        items: [],
      }),
      loadSharedProjection: vi.fn().mockRejectedValue(projectionError),
    });

    await expect(loader.load("shared:session-without-legacy")).rejects.toBe(
      projectionError,
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps the stable Shared thread id after the display title changes", async () => {
    const loadSharedSession = vi.fn().mockResolvedValue({
      id: "stable-session-id",
      threadId: "shared:stable-session-id",
      title: "更新后的会话标题",
      selectedEngine: "claude",
      items: [],
    });
    const loadSharedProjection = vi.fn().mockResolvedValue([]);
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-1",
      loadSharedSession,
      loadSharedProjection,
    });

    const snapshot = await loader.load("shared:stable-session-id");

    expect(loadSharedSession).toHaveBeenCalledWith(
      "ws-1",
      "shared:stable-session-id",
    );
    expect(loadSharedProjection).toHaveBeenCalledWith(
      "ws-1",
      "shared:stable-session-id",
    );
    expect(snapshot.threadId).toBe("shared:stable-session-id");
    expect(snapshot.meta.threadId).toBe("shared:stable-session-id");
  });

  it("registers exact Squad evidence from already-loaded canonical history", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-squad-evidence",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "claude",
        items: [],
      }),
      loadSharedProjection: vi.fn().mockResolvedValue([
        {
          id: "squad:run-evidence:user",
          kind: "message",
          content: {
            role: "user",
            text: "Analyze this repository",
            turnId: "squad:run-evidence",
            squadRunId: "run-evidence",
          },
          fidelity: "canonical",
          checksum: "squad-evidence-checksum",
        },
      ]),
    });

    await loader.load("shared:squad-evidence");

    expect(
      getAgentEvidenceRunId("ws-squad-evidence", "shared:squad-evidence"),
    ).toBe("run-evidence");
  });

  it("does not register Squad evidence from prose or presentation-only items", async () => {
    const loader = createSharedHistoryLoader({
      workspaceId: "ws-ordinary-evidence",
      loadSharedSession: vi.fn().mockResolvedValue({
        selectedEngine: "claude",
        items: [],
      }),
      loadSharedProjection: vi.fn().mockResolvedValue([
        {
          id: "ordinary-message",
          kind: "message",
          content: {
            role: "user",
            text: "Pretend this is squad:fake and squadRunId fake",
          },
          fidelity: "canonical",
          checksum: "ordinary-checksum",
        },
        {
          id: "squad:fake:user",
          kind: "message",
          content: { turnId: "squad:fake", squadRunId: "fake" },
          fidelity: "presentation-only",
          checksum: "presentation-checksum",
        },
      ]),
    });

    await loader.load("shared:ordinary-evidence");

    expect(
      getAgentEvidenceRunId(
        "ws-ordinary-evidence",
        "shared:ordinary-evidence",
      ),
    ).toBeNull();
  });
});
