// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCliVersionStatus } from "./useCliVersionStatus";

const { inspectManagedMock, getCliVersionStatusMock } = vi.hoisted(() => ({
  inspectManagedMock: vi.fn(),
  getCliVersionStatusMock: vi.fn(),
}));

vi.mock("@/features/account/runtime/managedEngineToolchain", () => ({
  createManagedEngineToolchainClientV1: () => ({
    inspect: inspectManagedMock,
  }),
  resolveManagedToolchainEngineIdV1: (engineId: string) =>
    engineId === "claude"
      ? "claude-code"
      : engineId === "codex" || engineId === "kimi"
        ? engineId
        : null,
}));

vi.mock("@/services/tauri", () => ({
  getCliVersionStatus: getCliVersionStatusMock,
}));

describe("useCliVersionStatus", () => {
  beforeEach(() => {
    inspectManagedMock.mockReset();
    getCliVersionStatusMock.mockReset();
  });

  it("reads Codex status from the managed toolchain instead of npm/PATH", async () => {
    inspectManagedMock.mockResolvedValue({
      ok: true,
      value: {
        engineId: "codex",
        status: "ready",
        bundledVersion: "0.147.0",
        externalVersion: null,
        selectedSource: "bundled",
      },
    });

    const { result } = renderHook(() =>
      useCliVersionStatus({ engine: "codex" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status).toMatchObject({
      engine: "codex",
      installed: true,
      localVersion: "0.147.0",
      latestVersion: null,
      nodeOk: true,
    });
    expect(inspectManagedMock).toHaveBeenCalledWith("codex");
    expect(getCliVersionStatusMock).not.toHaveBeenCalled();
  });

  it("reads Kimi status from the managed toolchain instead of npm/PATH", async () => {
    inspectManagedMock.mockResolvedValue({
      ok: true,
      value: {
        engineId: "kimi",
        status: "ready",
        bundledVersion: "0.38.0",
        externalVersion: null,
        selectedSource: "bundled",
      },
    });

    const { result } = renderHook(() =>
      useCliVersionStatus({ engine: "kimi" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status).toMatchObject({
      engine: "kimi",
      installed: true,
      localVersion: "0.38.0",
      latestVersion: null,
      nodeOk: true,
    });
    expect(inspectManagedMock).toHaveBeenCalledWith("kimi");
    expect(getCliVersionStatusMock).not.toHaveBeenCalled();
  });

  it("uses the selected external version for managed Claude", async () => {
    inspectManagedMock.mockResolvedValue({
      ok: true,
      value: {
        engineId: "claude-code",
        status: "ready",
        bundledVersion: "2.1.233",
        externalVersion: "2.1.240",
        selectedSource: "external",
      },
    });

    const { result } = renderHook(() =>
      useCliVersionStatus({ engine: "claude" }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.status).toMatchObject({
      engine: "claude",
      installed: true,
      localVersion: "2.1.240",
      latestVersion: null,
    });
    expect(inspectManagedMock).toHaveBeenCalledWith("claude-code");
    expect(getCliVersionStatusMock).not.toHaveBeenCalled();
  });
});
