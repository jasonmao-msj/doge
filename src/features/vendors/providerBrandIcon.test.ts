import { describe, expect, it } from "vitest";

import {
  PROVIDER_BRAND_ICON_SRC,
  providerBrandIconThemeStrategy,
  resolveProviderBrandIcon,
  resolveVendorFromModelId,
} from "./providerBrandIcon";

describe("providerBrandIcon", () => {
  it("owns theme strategies for monochrome, color, and dark-tile brands", () => {
    expect(providerBrandIconThemeStrategy(PROVIDER_BRAND_ICON_SRC.openai))
      .toBe("mono-adaptive");
    expect(providerBrandIconThemeStrategy(PROVIDER_BRAND_ICON_SRC.doubao))
      .toBe("original");
    expect(providerBrandIconThemeStrategy(PROVIDER_BRAND_ICON_SRC.kimi))
      .toBe("dark-tile");
  });

  it("maps the Chinese Doubao model alias to the Doubao brand", () => {
    expect(PROVIDER_BRAND_ICON_SRC.doubao).toContain("doubao.png");
    expect(resolveVendorFromModelId("豆包")).toBe("doubao");
    expect(resolveVendorFromModelId("doubao-entry")).toBe("doubao");
    expect(resolveVendorFromModelId("ark-code-latest")).toBe("doubao");
    expect(resolveProviderBrandIcon({ modelId: "豆包" })).toBe(
      PROVIDER_BRAND_ICON_SRC.doubao,
    );
    expect(resolveProviderBrandIcon({ modelId: "ark-code-latest" })).toBe(
      PROVIDER_BRAND_ICON_SRC.doubao,
    );
  });
});
