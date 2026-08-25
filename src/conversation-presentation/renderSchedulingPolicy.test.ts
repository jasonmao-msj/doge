// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  RENDER_SCHEDULE_TIER_DEFAULT,
  RENDER_TIER_FLAG_KEY,
  getTierSchedule,
  isRenderScheduleTier,
  readRenderScheduleTierFromStorage,
  resolveDispatchSchedule,
  resolveDispatchSubmitMode,
  resolveLaneSchedule,
  resolveRenderScheduleTier,
  type RenderScheduleTier,
} from "./renderSchedulingPolicy";

describe("renderSchedulingPolicy (v2 naming)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("exports the v2 tier defaults and storage key", () => {
    expect(RENDER_SCHEDULE_TIER_DEFAULT).toBe("guarded");
    expect(RENDER_TIER_FLAG_KEY).toBe("doge.perf.streamingScheduleTier");
  });

  it("falls back to guarded for null, undefined, and unknown strings", () => {
    expect(resolveRenderScheduleTier(null)).toBe("guarded");
    expect(resolveRenderScheduleTier(undefined)).toBe("guarded");
    expect(resolveRenderScheduleTier("")).toBe("guarded");
    expect(resolveRenderScheduleTier("fast")).toBe("guarded");
    expect(resolveRenderScheduleTier(123 as unknown as string)).toBe("guarded");
  });

  it("accepts the three documented tier values verbatim", () => {
    const tiers: RenderScheduleTier[] = ["baseline", "guarded", "aggressive"];
    for (const tier of tiers) {
      expect(isRenderScheduleTier(tier)).toBe(true);
      expect(resolveRenderScheduleTier(tier)).toBe(tier);
    }
  });

  it("returns the tier schedule constants deterministically", () => {
    expect(getTierSchedule("baseline")).toMatchObject({
      useTransition: false,
      useRafDelay: false,
      allowDrop: false,
      budgetMs: 0,
      idleTimeoutMs: 0,
    });
    expect(getTierSchedule("guarded").budgetMs).toBeGreaterThan(
      getTierSchedule("aggressive").budgetMs,
    );
    expect(getTierSchedule("baseline").allowDrop).toBe(false);
    expect(getTierSchedule("guarded").allowDrop).toBe(true);
    expect(getTierSchedule("aggressive").allowDrop).toBe(true);
  });

  it("bypasses scheduling for critical and live-row events", () => {
    const critical = resolveDispatchSchedule({
      tier: "aggressive",
      isLiveRow: false,
      isHeavy: true,
      isCritical: true,
    });
    const live = resolveDispatchSchedule({
      tier: "aggressive",
      isLiveRow: true,
      isHeavy: true,
      isCritical: false,
    });
    for (const schedule of [critical, live]) {
      expect(schedule.useTransition).toBe(false);
      expect(schedule.useRafDelay).toBe(false);
      expect(schedule.allowDrop).toBe(false);
      expect(schedule.budgetMs).toBe(0);
      expect(schedule.idleTimeoutMs).toBe(0);
    }
  });

  it("scales budget by tier for non-live non-critical events", () => {
    const baseline = resolveDispatchSchedule({
      tier: "baseline",
      isLiveRow: false,
      isHeavy: false,
      isCritical: false,
    });
    const guarded = resolveDispatchSchedule({
      tier: "guarded",
      isLiveRow: false,
      isHeavy: false,
      isCritical: false,
    });
    const aggressive = resolveDispatchSchedule({
      tier: "aggressive",
      isLiveRow: false,
      isHeavy: false,
      isCritical: false,
    });
    expect(baseline.useTransition).toBe(false);
    expect(guarded.useTransition).toBe(true);
    expect(aggressive.useTransition).toBe(true);
    expect(baseline.budgetMs).toBe(0);
    expect(baseline.idleTimeoutMs).toBe(0);
    expect(guarded.budgetMs).toBeGreaterThan(aggressive.budgetMs);
  });

  it("keeps interaction lane urgent even under aggressive canvas pressure", () => {
    const interaction = resolveLaneSchedule({
      lane: "interaction",
      tier: "aggressive",
      isLiveRow: false,
      isHeavy: true,
      isCritical: false,
    });

    expect(interaction).toMatchObject({
      useTransition: false,
      useRafDelay: false,
      allowDrop: false,
      budgetMs: 0,
      idleTimeoutMs: 0,
    });
  });

  it("bounds canvas and background lanes without changing critical fast paths", () => {
    const canvas = resolveLaneSchedule({
      lane: "canvas",
      tier: "guarded",
      isLiveRow: false,
      isHeavy: true,
      isCritical: false,
    });
    const background = resolveLaneSchedule({
      lane: "background",
      tier: "guarded",
      isLiveRow: false,
      isHeavy: true,
      isCritical: false,
    });
    const criticalCanvas = resolveLaneSchedule({
      lane: "canvas",
      tier: "aggressive",
      isLiveRow: false,
      isHeavy: true,
      isCritical: true,
    });

    expect(canvas.allowDrop).toBe(true);
    expect(canvas.budgetMs).toBe(8);
    expect(background.allowDrop).toBe(true);
    expect(background.budgetMs).toBeLessThan(canvas.budgetMs);
    expect(background.idleTimeoutMs).toBeGreaterThan(canvas.idleTimeoutMs);
    expect(criticalCanvas.allowDrop).toBe(false);
    expect(criticalCanvas.budgetMs).toBe(0);
  });

  it("reads tier from localStorage and never throws on invalid input", () => {
    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, "aggressive");
    expect(readRenderScheduleTierFromStorage()).toBe("aggressive");

    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, "garbage");
    expect(readRenderScheduleTierFromStorage()).toBe("guarded");

    window.localStorage.removeItem(RENDER_TIER_FLAG_KEY);
    expect(readRenderScheduleTierFromStorage()).toBe("guarded");
  });
});


describe("resolveDispatchSubmitMode (\u00a76.3)", () => {
  it("isCritical forces urgent regardless of tier", () => {
    expect(
      resolveDispatchSubmitMode({ tier: "guarded", isLiveRow: false, isHeavy: false, isCritical: true }),
    ).toBe("urgent");
    expect(
      resolveDispatchSubmitMode({ tier: "aggressive", isLiveRow: false, isHeavy: false, isCritical: true }),
    ).toBe("urgent");
  });

  it("isLiveRow forces urgent regardless of tier", () => {
    expect(
      resolveDispatchSubmitMode({ tier: "guarded", isLiveRow: true, isHeavy: false, isCritical: false }),
    ).toBe("urgent");
    expect(
      resolveDispatchSubmitMode({ tier: "aggressive", isLiveRow: true, isHeavy: false, isCritical: false }),
    ).toBe("urgent");
  });

  it("baseline always returns urgent", () => {
    expect(
      resolveDispatchSubmitMode({ tier: "baseline", isLiveRow: false, isHeavy: false, isCritical: false }),
    ).toBe("urgent");
  });

  it("guarded non-live non-critical returns transition", () => {
    expect(
      resolveDispatchSubmitMode({ tier: "guarded", isLiveRow: false, isHeavy: false, isCritical: false }),
    ).toBe("transition");
  });

  it("aggressive non-live non-critical returns idle", () => {
    expect(
      resolveDispatchSubmitMode({ tier: "aggressive", isLiveRow: false, isHeavy: false, isCritical: false }),
    ).toBe("idle");
  });
});
