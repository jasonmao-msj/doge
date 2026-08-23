import { describe, expect, it } from "vitest";

import {
  PROVIDER_BRAND_ICON_SRC,
  resolveProviderBrandIcon,
  resolveVendorFromModelId,
} from "./providerBrandIcon";

describe("providerBrandIcon", () => {
  it("maps the Chinese Doubao model alias to the Doubao brand", () => {
    expect(resolveVendorFromModelId("豆包")).toBe("doubao");
    expect(resolveVendorFromModelId("ark-code-latest")).toBe("doubao");
    expect(resolveProviderBrandIcon({ modelId: "豆包" })).toBe(
      PROVIDER_BRAND_ICON_SRC.doubao,
    );
    expect(resolveProviderBrandIcon({ modelId: "ark-code-latest" })).toBe(
      PROVIDER_BRAND_ICON_SRC.doubao,
    );
  });
});
