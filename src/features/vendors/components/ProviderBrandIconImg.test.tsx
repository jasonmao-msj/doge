// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProviderBrandIconImg } from "./ProviderBrandIconImg";
import { PROVIDER_BRAND_ICON_SRC } from "../providerBrandIcon";

describe("ProviderBrandIconImg", () => {
  it("bounds raster assets before consumer styles load", () => {
    const { container } = render(
      <span style={{ width: 18, height: 18 }}>
        <ProviderBrandIconImg src="/assets/doubao.png" />
      </span>,
    );
    const image = container.querySelector("img");

    expect(image?.getAttribute("width")).toBe("16");
    expect(image?.getAttribute("height")).toBe("16");
    expect(image?.style.width).toBe("16px");
    expect(image?.style.height).toBe("16px");
    expect(image?.style.maxWidth).toBe("100%");
    expect(image?.style.maxHeight).toBe("100%");
    expect(image?.style.objectFit).toBe("contain");
  });

  it("marks monochrome provider icons for global theme adaptation", () => {
    const { container } = render(
      <ProviderBrandIconImg src={PROVIDER_BRAND_ICON_SRC.openai} />,
    );
    const image = container.querySelector("img");

    expect(image?.classList.contains("vendor-brand-icon-img")).toBe(true);
    expect(image?.classList.contains("vendor-brand-icon-img--mono-adaptive")).toBe(true);
    expect(image?.classList.contains("vendor-brand-icon-tile")).toBe(false);
  });
});
