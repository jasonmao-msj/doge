// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_CONVENIENCE_V1_STORAGE_KEY,
  isAccountConvenienceV1Enabled,
} from "./featureFlag";

describe("Account convenience feature boundary", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("defaults on", () => {
    vi.stubEnv("VITE_DOGE_ACCOUNT_CONVENIENCE_V1", "");
    expect(isAccountConvenienceV1Enabled()).toBe(true);
  });

  it("supports a build-time emergency opt-out", () => {
    vi.stubEnv("VITE_DOGE_ACCOUNT_CONVENIENCE_V1", "0");
    expect(isAccountConvenienceV1Enabled()).toBe(false);
  });

  it("does not let local storage override a build-time kill switch", () => {
    vi.stubEnv("VITE_DOGE_ACCOUNT_CONVENIENCE_V1", "0");
    window.localStorage.setItem(ACCOUNT_CONVENIENCE_V1_STORAGE_KEY, "on");
    expect(isAccountConvenienceV1Enabled()).toBe(false);
  });

  it("supports local opt-out and degrades safely when storage is blocked", () => {
    vi.stubEnv("VITE_DOGE_ACCOUNT_CONVENIENCE_V1", "1");
    window.localStorage.setItem(ACCOUNT_CONVENIENCE_V1_STORAGE_KEY, "off");
    expect(isAccountConvenienceV1Enabled()).toBe(false);

    window.localStorage.clear();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    expect(isAccountConvenienceV1Enabled()).toBe(true);
  });
});
