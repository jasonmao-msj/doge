import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeSourceText } from "@/test/sourceText";

const settingsPart3Css = normalizeSourceText(
  readFileSync(
    new URL("./settings.part3.css", import.meta.url),
    "utf8",
  ),
);

describe("settings basic light controls", () => {
  it("forces native controls to render with the light color scheme", () => {
    expect(settingsPart3Css).toContain(
      ':root[data-theme="light"] .settings-section-basic,\n:root[data-theme="light"] .settings-section-tabbed {\n  color-scheme: light;',
    );
    expect(settingsPart3Css).toContain(
      ':root[data-theme="light"] .settings-section-basic select,\n:root[data-theme="light"] .settings-section-basic input,',
    );
    expect(settingsPart3Css).toContain(
      ":root:not([data-theme]) .settings-section-basic select,\n  :root:not([data-theme]) .settings-section-basic input,",
    );
  });
});
