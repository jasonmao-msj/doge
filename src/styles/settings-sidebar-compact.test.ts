import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const settingsCss = readFileSync(
  fileURLToPath(new URL("./settings.part1.css", import.meta.url)),
  "utf8",
);

function getCssRuleBlock(css: string, selector: string): string {
  const escapedSelector = selector
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("settings sidebar compact layout", () => {
  it("keeps the expanded settings sidebar narrow enough to avoid a blank gutter", () => {
    const bodyRule = getCssRuleBlock(settingsCss, ".settings-body");

    expect(bodyRule).toContain("grid-template-columns: 200px minmax(0, 1fr);");
  });
});
