import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("isAccountUiPreviewV1Enabled", () => {
  it("is disabled unless the build explicitly enables preview", async () => {
    vi.stubEnv("VITE_DOGE_ACCOUNT_UI_PREVIEW_V1", "");
    const { isAccountUiPreviewV1Enabled } = await import("./uiPreviewFlag");
    expect(isAccountUiPreviewV1Enabled()).toBe(false);
  });

  it("accepts only the exact build value 1", async () => {
    vi.stubEnv("VITE_DOGE_ACCOUNT_UI_PREVIEW_V1", "true");
    expect((await import("./uiPreviewFlag")).isAccountUiPreviewV1Enabled()).toBe(false);
    vi.resetModules();
    vi.stubEnv("VITE_DOGE_ACCOUNT_UI_PREVIEW_V1", "1");
    expect((await import("./uiPreviewFlag")).isAccountUiPreviewV1Enabled()).toBe(true);
  });
});
