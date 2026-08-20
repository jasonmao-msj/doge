import { describe, expect, it } from "vitest";
import {
  buildAvailableEngines,
  ENABLED_ENGINE_TYPES,
} from "./engineControllerAvailability";

describe("engineControllerAvailability", () => {
  it("projects labels from the canonical registry and excludes retired engines", () => {
    expect(ENABLED_ENGINE_TYPES).toEqual([
      "claude",
      "codex",
      "grok",
      "kimi",
      "opencode",
    ]);
    expect(buildAvailableEngines([], false)).toEqual([
      expect.objectContaining({
        type: "claude",
        displayName: "Claude",
        shortName: "Claude",
        availabilityState: "loading",
      }),
      expect.objectContaining({
        type: "codex",
        displayName: "Codex",
        shortName: "Codex",
      }),
      expect.objectContaining({
        type: "grok",
        displayName: "Grok",
        shortName: "Grok",
      }),
      expect.objectContaining({
        type: "kimi",
        displayName: "Kimi",
        shortName: "Kimi",
      }),
      expect.objectContaining({
        type: "opencode",
        displayName: "OpenCode",
        shortName: "OpenCode",
      }),
    ]);
  });
});
