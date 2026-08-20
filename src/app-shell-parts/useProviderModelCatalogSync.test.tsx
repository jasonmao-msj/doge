// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EngineType } from "../types";
import {
  clearManagedEngineEntitlementsV1,
  markManagedEnginePreparedV1,
  publishManagedEngineEntitlementsV1,
} from "../features/account/runtime/engineEntitlementStore";
import { useProviderModelCatalogSync } from "./useProviderModelCatalogSync";

const activateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../features/vendors/activateEngineProviderProfile", () => ({
  activateEngineProviderProfileAndNotify: activateMock,
  isActivatableProviderEngine: (engine: string) =>
    ["claude", "codex", "kimi", "grok", "opencode"].includes(engine),
}));

describe("useProviderModelCatalogSync", () => {
  beforeEach(() => {
    activateMock.mockClear();
    activateMock.mockResolvedValue(undefined);
    clearManagedEngineEntitlementsV1();
  });

  it("refreshes catalog and activates provider when the active scope changes", async () => {
    const addDebugEntry = vi.fn();
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(
      ({ providerProfileId }) =>
        useProviderModelCatalogSync({
          activeEngine: "claude",
          activeThreadEngineSource: "claude",
          activeThreadId: "claude-pending-1",
          activeWorkspaceId: "ws-1",
          providerProfileId,
          addDebugEntry,
          refreshEngineModels,
        }),
      { initialProps: { providerProfileId: "provider-a" } },
    );

    expect(refreshEngineModels).toHaveBeenCalledTimes(1);
    expect(refreshEngineModels).toHaveBeenCalledWith("claude", {
      providerProfileId: "provider-a",
      forceRefresh: true,
      phase: "on-demand",
    });
    await waitFor(() => {
      expect(activateMock).toHaveBeenCalledWith("claude", "provider-a");
    });
    expect(addDebugEntry).toHaveBeenCalledTimes(1);

    view.rerender({ providerProfileId: "provider-a" });
    expect(refreshEngineModels).toHaveBeenCalledTimes(1);

    view.rerender({ providerProfileId: "provider-b" });
    expect(refreshEngineModels).toHaveBeenCalledTimes(2);
    expect(refreshEngineModels).toHaveBeenLastCalledWith("claude", {
      providerProfileId: "provider-b",
      forceRefresh: true,
      phase: "on-demand",
    });
    await waitFor(() => {
      expect(activateMock).toHaveBeenLastCalledWith("claude", "provider-b");
    });
    expect(addDebugEntry).toHaveBeenCalledTimes(2);
  });

  it("supports Codex, Grok and Kimi but ignores engines without provider profiles", async () => {
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);
    const addDebugEntry = vi.fn();
    type HookProps = {
      activeEngine: "codex" | "grok" | "kimi" | "gemini";
    };
    const view = renderHook(
      ({ activeEngine }: HookProps) =>
        useProviderModelCatalogSync({
          activeEngine,
          activeThreadEngineSource: activeEngine,
          activeThreadId: "thread-1",
          activeWorkspaceId: "ws-1",
          providerProfileId: "provider-a",
          addDebugEntry,
          refreshEngineModels,
        }),
      {
        initialProps: {
          activeEngine: "codex",
        },
      },
    );

    expect(refreshEngineModels).toHaveBeenCalledWith("codex", {
      providerProfileId: "provider-a",
      forceRefresh: true,
      phase: "on-demand",
    });
    await waitFor(() => {
      expect(activateMock).toHaveBeenCalledWith("codex", "provider-a");
    });
    view.rerender({ activeEngine: "grok" });
    expect(refreshEngineModels).toHaveBeenLastCalledWith("grok", {
      providerProfileId: "provider-a",
      forceRefresh: true,
      phase: "on-demand",
    });
    view.rerender({ activeEngine: "kimi" });
    expect(refreshEngineModels).toHaveBeenLastCalledWith("kimi", {
      providerProfileId: "provider-a",
      forceRefresh: true,
      phase: "on-demand",
    });
    view.rerender({ activeEngine: "gemini" });

    expect(refreshEngineModels).toHaveBeenCalledTimes(3);
  });

  it("uses the active thread engine while the global engine is still switching", () => {
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);
    const addDebugEntry = vi.fn();
    type HookProps = {
      activeEngine: EngineType;
    };
    const view = renderHook(
      ({ activeEngine }: HookProps) =>
        useProviderModelCatalogSync({
          activeEngine,
          activeThreadEngineSource: "codex",
          activeThreadId: "codex-thread-1",
          activeWorkspaceId: "ws-1",
          providerProfileId: "__disk__",
          addDebugEntry,
          refreshEngineModels,
        }),
      { initialProps: { activeEngine: "claude" } },
    );

    expect(refreshEngineModels).toHaveBeenCalledTimes(1);
    expect(refreshEngineModels).toHaveBeenCalledWith("codex", {
      providerProfileId: "__disk__",
      forceRefresh: true,
      phase: "on-demand",
    });

    view.rerender({ activeEngine: "codex" });
    expect(refreshEngineModels).toHaveBeenCalledTimes(1);
  });

  it("keeps the last-good catalog when a provider-bound thread has no engine scope", () => {
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useProviderModelCatalogSync({
        activeEngine: "claude",
        activeThreadEngineSource: null,
        activeThreadId: "legacy-thread-1",
        activeWorkspaceId: "ws-1",
        providerProfileId: "provider-a",
        addDebugEntry: vi.fn(),
        refreshEngineModels,
      }),
    );

    expect(refreshEngineModels).not.toHaveBeenCalled();
    expect(activateMock).not.toHaveBeenCalled();
  });

  it("does not activate L1 when the session has no providerProfileId", () => {
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useProviderModelCatalogSync({
        activeEngine: "claude",
        activeThreadEngineSource: "claude",
        activeThreadId: "claude:legacy",
        activeWorkspaceId: "ws-1",
        providerProfileId: null,
        addDebugEntry: vi.fn(),
        refreshEngineModels,
      }),
    );
    expect(refreshEngineModels).toHaveBeenCalledWith("claude", {
      providerProfileId: null,
      forceRefresh: true,
      phase: "on-demand",
    });
    expect(activateMock).not.toHaveBeenCalled();
  });

  it("refreshes the prepared managed default without an active thread", () => {
    publishManagedEngineEntitlementsV1([
      {
        id: "codex",
        displayName: "Codex",
        entitlement: { status: "active", expiresAt: null },
      },
      {
        id: "claude-code",
        displayName: "Claude",
        entitlement: { status: "none", expiresAt: null },
      },
    ]);
    markManagedEnginePreparedV1("codex");
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useProviderModelCatalogSync({
        activeEngine: "codex",
        activeThreadEngineSource: null,
        activeThreadId: null,
        activeWorkspaceId: "ws-1",
        providerProfileId: null,
        addDebugEntry: vi.fn(),
        refreshEngineModels,
      }),
    );

    expect(refreshEngineModels).toHaveBeenCalledWith("codex", {
      providerProfileId: "doge-token-matrix",
      forceRefresh: true,
      phase: "on-demand",
    });
    expect(activateMock).not.toHaveBeenCalled();
  });

  it("does not refresh a non-managed engine without an active thread", () => {
    const refreshEngineModels = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useProviderModelCatalogSync({
        activeEngine: "codex",
        activeThreadEngineSource: null,
        activeThreadId: null,
        activeWorkspaceId: "ws-1",
        providerProfileId: "provider-a",
        addDebugEntry: vi.fn(),
        refreshEngineModels,
      }),
    );

    expect(refreshEngineModels).not.toHaveBeenCalled();
  });
});
