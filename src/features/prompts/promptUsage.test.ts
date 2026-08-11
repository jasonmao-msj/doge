// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPromptUsageForTests,
  getPromptHeatLevel,
  getPromptUsageEntry,
  loadPromptUsage,
  recordPromptUsage,
} from "./promptUsage";

describe("promptUsage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearPromptUsageForTests();
  });

  it("records prompt usage counts and timestamps", () => {
    recordPromptUsage("prompt:a", 100);
    recordPromptUsage("prompt:a", 200);

    expect(getPromptUsageEntry("prompt:a")).toEqual({
      count: 2,
      lastUsedAt: 200,
    });
  });

  it("reads legacy mossx prompt usage from localStorage and rewrites it to ccgui", () => {
    window.localStorage.setItem(
      "mossx.promptUsage.v1",
      JSON.stringify({
        "prompt:legacy": {
          count: 3,
          lastUsedAt: 120,
        },
      }),
    );

    expect(loadPromptUsage()).toEqual({
      "prompt:legacy": {
        count: 3,
        lastUsedAt: 120,
      },
    });

    recordPromptUsage("prompt:legacy", 200);

    expect(JSON.parse(window.localStorage.getItem("doge.promptUsage.v1") ?? "{}")).toEqual({
      "prompt:legacy": {
        count: 4,
        lastUsedAt: 200,
      },
    });
  });

  it("maps prompt usage counts into heat levels", () => {
    expect(getPromptHeatLevel(0)).toBe(0);
    expect(getPromptHeatLevel(1)).toBe(1);
    expect(getPromptHeatLevel(4)).toBe(2);
    expect(getPromptHeatLevel(8)).toBe(3);
  });
});
