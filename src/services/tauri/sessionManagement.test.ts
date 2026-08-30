import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNativeProviderContinuation,
  discardPreparedNativeProviderContinuation,
  prepareNativeProviderContinuation,
  getSessionExecutionTarget,
  recordSessionExecutionTarget,
  type NativeProviderContinuationInput,
} from "./sessionManagement";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const INPUT: NativeProviderContinuationInput = {
  workspaceId: "workspace-1",
  operationId: "operation-1",
  source: {
    sessionId: "claude:source-1",
    nativeSessionId: "source-1",
    engine: "claude",
    providerProfileId: "provider-a",
  },
  destination: {
    engine: "codex",
    providerProfileId: "provider-b",
    model: "gpt-target",
  },
};

describe("native Provider continuation commands", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue({});
  });

  it("maps prepare, discard, and confirmed create to the same operation", async () => {
    await prepareNativeProviderContinuation(INPUT);
    await discardPreparedNativeProviderContinuation(INPUT);
    await createNativeProviderContinuation({
      ...INPUT,
      confirmDegraded: true,
    });

    const basePayload = {
      workspaceId: "workspace-1",
      operationId: "operation-1",
      source: INPUT.source,
      destination: INPUT.destination,
    };
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      "prepare_native_provider_continuation",
      basePayload,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "discard_prepared_native_provider_continuation",
      basePayload,
    );
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      "create_native_provider_continuation",
      {
        ...basePayload,
        confirmDegraded: true,
      },
    );
  });
});

describe("session execution target command", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("maps the selected session target with a nullable effort", async () => {
    await recordSessionExecutionTarget({
      workspaceId: "workspace-1",
      sessionId: "codex:session-1",
      engine: "codex",
      modelCatalogEntryId: "doubao-entry",
      model: "doubao-runtime",
      reasoningEffort: null,
    });

    expect(invoke).toHaveBeenCalledWith("record_session_execution_target", {
      workspaceId: "workspace-1",
      sessionId: "codex:session-1",
      engine: "codex",
      modelCatalogEntryId: "doubao-entry",
      model: "doubao-runtime",
      reasoningEffort: null,
    });
  });

  it("reads the targeted session target without scanning the catalog", async () => {
    vi.mocked(invoke).mockResolvedValue({
      modelCatalogEntryId: "doubao-entry",
      model: "doubao-runtime",
      reasoningEffort: "high",
    });

    await expect(
      getSessionExecutionTarget({
        workspaceId: "workspace-1",
        sessionId: "kimi:session-1",
        engine: "kimi",
      }),
    ).resolves.toEqual({
      modelCatalogEntryId: "doubao-entry",
      model: "doubao-runtime",
      reasoningEffort: "high",
    });
    expect(invoke).toHaveBeenCalledWith("get_session_execution_target", {
      workspaceId: "workspace-1",
      sessionId: "kimi:session-1",
      engine: "kimi",
    });
  });
});
