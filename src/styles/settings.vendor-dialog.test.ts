import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const vendorDialogCss = readFileSync(
  fileURLToPath(new URL("./settings.vendor-dialog.css", import.meta.url)),
  "utf8",
);

function getCssRuleBlock(css: string, selector: string): string {
  const escapedSelector = selector
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const match = css.match(
    new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`),
  );
  return match?.[1] ?? "";
}

describe("vendor official config dialog layout", () => {
  it("shares multi-pane grid chrome for official config editors", () => {
    const multiPaneRule = getCssRuleBlock(
      vendorDialogCss,
      ".vendor-official-config-dialog-body.is-multi-pane",
    );
    const editorRule = getCssRuleBlock(
      vendorDialogCss,
      ".vendor-official-config-dialog-body .vendor-official-json-editor,\n" +
        ".vendor-official-config-dialog-body .vendor-official-code-editor",
    );
    const paneRule = getCssRuleBlock(
      vendorDialogCss,
      ".vendor-official-config-dialog-body .vendor-official-config-pane",
    );
    const paneMetaRule = getCssRuleBlock(
      vendorDialogCss,
      ".vendor-official-config-pane-meta",
    );
    const panePathRule = getCssRuleBlock(
      vendorDialogCss,
      ".vendor-official-config-pane-path",
    );

    expect(multiPaneRule).toContain("display: grid;");
    expect(multiPaneRule).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
    expect(editorRule).toContain("min-height: clamp(280px, 48vh, 560px);");
    expect(paneRule).toContain("border-radius: 12px;");
    expect(paneMetaRule).toContain("align-items: center;");
    expect(paneMetaRule).not.toContain("flex-direction: column;");
    expect(panePathRule).toContain("background: transparent;");
    expect(panePathRule).toContain("white-space: nowrap;");
  });
});
