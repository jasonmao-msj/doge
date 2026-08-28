// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const provisioning = vi.hoisted(() => {
  let snapshot = {
    engine: null as "codex" | "claude" | "kimi" | null,
    phase: "idle" as string,
    errorCode: null as string | null,
    retryable: false,
  };
  const listeners = new Set<() => void>();
  return {
    read: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next: typeof snapshot) => {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
    dismiss: vi.fn(),
    retry: vi.fn(async () => undefined),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "update.engineProvisioning.installing": "Installing…",
        "update.engineProvisioning.failed": "Setup failed",
        "update.engineProvisioning.ready": "Ready",
        "common.dismiss": "Dismiss",
        "common.retry": "Retry",
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock("../runtime/productEngineProvisioning", () => ({
  dismissProductEngineProvisioningV1: provisioning.dismiss,
  readProductEngineProvisioningSnapshotV1: provisioning.read,
  retryProductEngineProvisioningV1: provisioning.retry,
  subscribeProductEngineProvisioningV1: provisioning.subscribe,
}));

import { EngineProvisioningToast } from "./EngineProvisioningToast";

afterEach(() => {
  provisioning.dismiss.mockClear();
  provisioning.retry.mockClear();
  act(() => {
    provisioning.set({
      engine: null,
      phase: "idle",
      errorCode: null,
      retryable: false,
    });
  });
  vi.useRealTimers();
});

describe("EngineProvisioningToast", () => {
  it("shows only the engine, current phase, and honest indeterminate progress", () => {
    render(<EngineProvisioningToast />);

    act(() =>
      provisioning.set({
        engine: "kimi",
        phase: "installing",
        errorCode: null,
        retryable: false,
      }),
    );

    expect(screen.getAllByText("Kimi CLI")).toHaveLength(1);
    expect(screen.getByText("Installing…")).toBeTruthy();
    expect(screen.queryByText(/keep using Doge/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(
      document.querySelector(".engine-provisioning-progress-indeterminate"),
    ).toBeTruthy();
    expect(
      document
        .querySelector(".update-toast-progress-fill")
        ?.hasAttribute("style"),
    ).toBe(false);
  });

  it("offers retry and dismiss after a failed install", () => {
    render(<EngineProvisioningToast />);
    act(() =>
      provisioning.set({
        engine: "codex",
        phase: "error",
        errorCode: "engineInstallFailed",
        retryable: true,
      }),
    );

    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Setup failed")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(provisioning.retry).toHaveBeenCalledTimes(1);
    expect(provisioning.dismiss).toHaveBeenCalledTimes(1);
  });

  it("automatically dismisses a completed install", () => {
    vi.useFakeTimers();
    render(<EngineProvisioningToast />);
    act(() =>
      provisioning.set({
        engine: "claude",
        phase: "ready",
        errorCode: null,
        retryable: false,
      }),
    );

    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(document.querySelector(".update-toast-progress")).toBeNull();
    act(() => vi.advanceTimersByTime(2_000));
    expect(provisioning.dismiss).toHaveBeenCalledTimes(1);
  });
});
