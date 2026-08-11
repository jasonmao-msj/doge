// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { isMultiAgentEnabled } from "./featureFlag";

const STORAGE_KEY = "doge.agentOrchestrationV1";
const LEGACY_KEY = "doge.squadOrchestrationV1";

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_KEY);
});

describe("isMultiAgentEnabled", () => {
  it("defaults to true when no storage/env override", () => {
    expect(isMultiAgentEnabled()).toBe(true);
  });

  it("respects explicit localStorage off", () => {
    window.localStorage.setItem(STORAGE_KEY, "0");
    expect(isMultiAgentEnabled()).toBe(false);
  });

  it("respects explicit localStorage on", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    expect(isMultiAgentEnabled()).toBe(true);
  });

  it("accepts legacy storage key", () => {
    window.localStorage.setItem(LEGACY_KEY, "false");
    expect(isMultiAgentEnabled()).toBe(false);
  });
});
