// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCodingPlanQuota } from "../../../services/tauri";
import {
  loadManagedAccountQuotaSnapshots,
  TOKEN_MATRIX_UNAVAILABLE_MESSAGE,
} from "../utils/managedAccountQuota";
import type { SessionQuotaTarget } from "../utils/sessionQuotaTargets";
import { useSessionQuotaList } from "./useSessionQuotaList";

vi.mock("../../../services/tauri", () => ({
  getCodingPlanQuota: vi.fn(),
}));

vi.mock("../utils/managedAccountQuota", () => ({
  TOKEN_MATRIX_UNAVAILABLE_MESSAGE: "Token Matrix 额度暂时不可用，请稍后重试",
  isManagedAccountQuotaTarget: (target: SessionQuotaTarget) =>
    target.providerProfileId === "doge-token-matrix" &&
    (target.engine === "codex" || target.engine === "claude"),
  loadManagedAccountQuotaSnapshots: vi.fn(),
}));

const managedCodex: SessionQuotaTarget = {
  key: "codex::doge-token-matrix",
  engine: "codex",
  providerProfileId: "doge-token-matrix",
  providerLabel: "Token Matrix",
  model: null,
};

const managedClaude: SessionQuotaTarget = {
  key: "claude::doge-token-matrix",
  engine: "claude",
  providerProfileId: "doge-token-matrix",
  providerLabel: "Token Matrix",
  model: null,
};

const localGemini: SessionQuotaTarget = {
  key: "gemini::local",
  engine: "gemini",
  providerProfileId: null,
  providerLabel: "Gemini",
  model: null,
};

function snapshot(source = "coding_plan") {
  return {
    source,
    success: true,
    error: null,
    planLabel: null,
    windows: [],
    queriedAt: 1,
  };
}

describe("useSessionQuotaList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses one managed authority group read while preserving target order", async () => {
    vi.mocked(loadManagedAccountQuotaSnapshots).mockResolvedValue([
      { target: managedCodex, snapshot: snapshot("token_matrix") },
      { target: managedClaude, snapshot: snapshot("token_matrix") },
    ]);
    vi.mocked(getCodingPlanQuota).mockResolvedValue(snapshot());
    const targets = [managedCodex, localGemini, managedClaude];

    const { result } = renderHook(() =>
      useSessionQuotaList({
        targets,
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(loadManagedAccountQuotaSnapshots).toHaveBeenCalledTimes(1);
    expect(loadManagedAccountQuotaSnapshots).toHaveBeenCalledWith([
      managedCodex,
      managedClaude,
    ]);
    expect(getCodingPlanQuota).toHaveBeenCalledTimes(1);
    expect(result.current.entries.map((entry) => entry.target.key)).toEqual([
      managedCodex.key,
      localGemini.key,
      managedClaude.key,
    ]);
  });

  it("does not read the account authority without a managed target", async () => {
    vi.mocked(getCodingPlanQuota).mockResolvedValue(snapshot());
    const targets = [localGemini];

    const { result } = renderHook(() =>
      useSessionQuotaList({ targets }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(loadManagedAccountQuotaSnapshots).not.toHaveBeenCalled();
    expect(getCodingPlanQuota).toHaveBeenCalledWith("gemini", null);
  });

  it("does not expose a managed authority exception to the quota panel", async () => {
    vi.mocked(loadManagedAccountQuotaSnapshots).mockRejectedValue(
      new Error("raw upstream response"),
    );
    const targets = [managedCodex];

    const { result } = renderHook(() =>
      useSessionQuotaList({ targets }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.entries[0]).toMatchObject({
      error: TOKEN_MATRIX_UNAVAILABLE_MESSAGE,
      snapshot: {
        error: TOKEN_MATRIX_UNAVAILABLE_MESSAGE,
        source: "token_matrix",
        success: false,
      },
    });
  });
});
