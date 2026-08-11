// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STARTUP_GATE_OVERLAY_TEST_FLAG_KEY } from "@/features/startup-orchestration/utils/startupGateOverlayTestFlag";
import { OtherSection } from "./OtherSection";

const TRANSLATIONS: Record<string, string> = {
  "settings.sharedProjectionTestToggleTitle": "Use Canonical Projection",
  "settings.streamingScheduleTierTitle": "Streaming schedule tier",
  "settings.streamingScheduleTier.baseline": "Baseline",
  "settings.streamingScheduleTier.guarded": "Guarded",
  "settings.streamingScheduleTier.aggressive": "Aggressive",
  "settings.streamingScheduleTierDetail.baseline": "Baseline detail",
  "settings.streamingScheduleTierDetail.guarded": "Guarded detail",
  "settings.streamingScheduleTierDetail.aggressive": "Aggressive detail",
  "settings.performanceFlagsResetButton": "Reset",
  "settings.performanceFlagsResetAlreadyDefault": "Already default",
  "settings.startupGateOverlayTestTitle": "Startup loading overlay (test)",
};

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (typeof params?.count === "number") {
        return `${key}:${params.count}`;
      }
      return TRANSLATIONS[key] ?? key;
    },
  }),
}));

vi.mock("../../HistoryCompletionSettings", () => ({
  HistoryCompletionSettings: () => <div data-testid="history-completion-settings" />,
}));

vi.mock("../../../../curated-skills", () => ({
  CuratedSection: () => <div data-testid="curated-section-stub">Mock Curated Section</div>,
}));

vi.mock("./CostBudgetSettingsSection", () => ({
  CostBudgetSettingsSection: () => <div data-testid="cost-budget-settings" />,
}));

vi.mock("../../SessionRadarHistoryManagementSection", () => ({
  SessionRadarHistoryManagementSection: () => (
    <div data-testid="session-radar-history-management" />
  ),
}));

function renderOtherSection() {
  return render(
    <OtherSection
      title="Other"
      description="Other settings"
      appSettings={{ enabledCuratedSkillIds: [] }}
      onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      sessionRadarRecentCompletedSessions={[]}
      onDeleteSessionRadarHistory={vi.fn()}
    />,
  );
}

describe("OtherSection", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders curated skills inside other settings", () => {
    renderOtherSection();
    expect(screen.getByTestId("curated-section-stub")).toBeTruthy();
  });

  it("shows default-on and persists explicit negative/positive overrides", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    renderOtherSection();

    const toggle = screen.getByRole("switch", {
      name: "Use Canonical Projection",
    });
    expect(toggle.getAttribute("data-state")).toBe("checked");

    fireEvent.click(toggle);

    expect(window.localStorage.getItem("doge.sharedProjection")).toBe("0");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("data-state")).toBe("unchecked");

    fireEvent.click(toggle);

    expect(window.localStorage.getItem("doge.sharedProjection")).toBe("1");
    expect(reload).toHaveBeenCalledTimes(2);
    expect(toggle.getAttribute("data-state")).toBe("checked");
  });

  it("clears known realtime performance overrides and asks for reload", () => {
    window.localStorage.setItem("doge.perf.realtimeBatching", "0");
    window.localStorage.setItem("doge.perf.backgroundRenderGating", "off");
    window.localStorage.setItem("doge.perf.streamingScheduleTier", "aggressive");
    window.localStorage.setItem("doge.other.flag", "kept");

    renderOtherSection();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset",
      }),
    );

    expect(window.localStorage.getItem("doge.perf.realtimeBatching")).toBeNull();
    expect(window.localStorage.getItem("doge.perf.backgroundRenderGating")).toBeNull();
    expect(window.localStorage.getItem("doge.perf.streamingScheduleTier")).toBeNull();
    expect(window.localStorage.getItem("doge.other.flag")).toBe("kept");
    expect(
      screen.getByText("settings.performanceFlagsResetDone:3"),
    ).toBeTruthy();
  });

  it("defaults streaming schedule tier to guarded and persists changes", () => {
    renderOtherSection();

    const select = screen.getByRole("combobox", {
      name: "Streaming schedule tier",
    }) as HTMLSelectElement;
    expect(select.value).toBe("guarded");
    expect(screen.getByText("Baseline")).toBeTruthy();
    expect(screen.getByText("Guarded")).toBeTruthy();
    expect(screen.getByText("Aggressive")).toBeTruthy();
    expect(screen.getByText("Guarded detail")).toBeTruthy();

    fireEvent.change(select, { target: { value: "baseline" } });

    expect(select.value).toBe("baseline");
    expect(screen.getByText("Baseline detail")).toBeTruthy();
    expect(window.localStorage.getItem("doge.perf.streamingScheduleTier")).toBe(
      "baseline",
    );
  });

  it("reports default state when there are no overrides to clear", () => {
    renderOtherSection();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset",
      }),
    );

    expect(screen.getByText("Already default")).toBeTruthy();
  });

  it("defaults the startup loading test to off and persists explicit changes", () => {
    window.localStorage.setItem(STARTUP_GATE_OVERLAY_TEST_FLAG_KEY, "true");
    renderOtherSection();

    const toggle = screen.getByRole("switch", {
      name: "Startup loading overlay (test)",
    });
    expect(toggle.getAttribute("data-state")).toBe("unchecked");

    fireEvent.click(toggle);

    expect(
      window.localStorage.getItem(STARTUP_GATE_OVERLAY_TEST_FLAG_KEY),
    ).toBe("1");
    expect(toggle.getAttribute("data-state")).toBe("checked");

    fireEvent.click(toggle);

    expect(
      window.localStorage.getItem(STARTUP_GATE_OVERLAY_TEST_FLAG_KEY),
    ).toBeNull();
    expect(toggle.getAttribute("data-state")).toBe("unchecked");
  });
});
