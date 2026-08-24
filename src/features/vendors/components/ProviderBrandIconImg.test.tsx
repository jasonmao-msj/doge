// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProviderBrandIconImg } from "./ProviderBrandIconImg";

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
    expect(image?.style.maxWidth).toBe("100%");
    expect(image?.style.maxHeight).toBe("100%");
    expect(image?.style.objectFit).toBe("contain");
  });
});
