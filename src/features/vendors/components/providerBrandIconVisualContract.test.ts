import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseCss = readFileSync(
  new URL("../../../styles/base.css", import.meta.url),
  "utf8",
);

describe("provider brand icon visual contract", () => {
  it("keeps monochrome provider icons dark on light surfaces and light on dark surfaces", () => {
    expect(baseCss).toMatch(
      /\.vendor-brand-icon-img--mono-adaptive\s*\{[^}]*brightness\(0\)/s,
    );
    expect(baseCss).toMatch(
      /:root\[data-theme="dark"\][^{]*\.vendor-brand-icon-img--mono-adaptive[^{]*{[^}]*invert\(1\)/s,
    );
    expect(baseCss).toMatch(
      /:root\[data-theme="dim"\][^{]*\.vendor-brand-icon-img--mono-adaptive[^{]*{[^}]*invert\(1\)/s,
    );
    expect(baseCss).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*:root:not\(\[data-theme\]\) \.vendor-brand-icon-img--mono-adaptive[\s\S]*invert\(1\)/s,
    );
  });
});
