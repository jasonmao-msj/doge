import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fileViewPanelCss = readFileSync(
  fileURLToPath(new URL("./file-view-panel.css", import.meta.url)),
  "utf8",
);
const fileViewPanelShellCss = readFileSync(
  fileURLToPath(new URL("./file-view-panel-shell.css", import.meta.url)),
  "utf8",
);
const diffViewerCss = readFileSync(
  fileURLToPath(new URL("./diff-viewer.css", import.meta.url)),
  "utf8",
);

function getCssRuleBlock(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const match = css.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("file view visual contracts", () => {
  it("lets preset syntax tokens override file-view scoped fallbacks", () => {
    expect(fileViewPanelCss).toContain(
      "color: var(--theme-syntax-keyword, var(--fvp-token-keyword));",
    );
    expect(fileViewPanelCss).toContain(
      "color: var(--theme-syntax-tag, var(--fvp-token-property));",
    );
    expect(fileViewPanelCss).toContain(
      "color: var(--theme-syntax-function, var(--fvp-token-function));",
    );
  });

  it("keeps Git Blame gutter stable and current-line details inline", () => {
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-cm .cm-file-git-blame-gutter")).toContain(
      "var(--border-subtle)",
    );
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-cm .cm-file-git-blame-marker")).toContain(
      "text-overflow: ellipsis",
    );
    const inlineDetailsRule = getCssRuleBlock(
      fileViewPanelCss,
      ".fvp-cm .cm-file-git-blame-inline-details",
    );
    expect(inlineDetailsRule).toContain("max-width: min(520px, 48vw);");
    expect(inlineDetailsRule).toContain("text-overflow: ellipsis;");
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-cm .cm-file-git-blame-marker.is-current")).toBe(
      "",
    );
  });

  it("does not draw an accent underline under the active file tab", () => {
    const activeTabUnderline = getCssRuleBlock(
      fileViewPanelShellCss,
      ".fvp-tab.is-active::after",
    );

    expect(activeTabUnderline).toContain("background: var(--fvp-reader-surface);");
    expect(activeTabUnderline).not.toContain("var(--border-accent)");
  });

  it("hides file tab scrollbar chrome without disabling horizontal overflow", () => {
    const tabsRule = getCssRuleBlock(fileViewPanelShellCss, ".fvp-tabs");
    const webkitScrollbarRule = getCssRuleBlock(
      fileViewPanelShellCss,
      ".fvp-tabs::-webkit-scrollbar",
    );

    expect(tabsRule).toContain("overflow-x: auto;");
    expect(tabsRule).toContain("scrollbar-width: none;");
    expect(webkitScrollbarRule).toContain("display: none;");
  });

  it("keeps the file tab context menu rounded and theme-token based", () => {
    const menuRule = getCssRuleBlock(fileViewPanelCss, ".fvp-tab-context-menu");
    const itemRule = getCssRuleBlock(
      fileViewPanelCss,
      ".fvp-tab-context-menu .renderer-context-menu-item",
    );

    expect(menuRule).toContain("min-width: 238px;");
    expect(menuRule).toContain("border-radius: 14px;");
    expect(menuRule).toContain("var(--surface-popover)");
    expect(itemRule).toContain("border-radius: 8px;");
  });

  it("hides file context menu scrollbar chrome without disabling scrolling", () => {
    const menuRule = getCssRuleBlock(fileViewPanelCss, ".fvp-file-context-menu");
    const itemRule = getCssRuleBlock(
      fileViewPanelCss,
      ".fvp-file-context-menu .renderer-context-menu-item",
    );
    const separatorRule = getCssRuleBlock(
      fileViewPanelCss,
      ".fvp-file-context-menu .renderer-context-menu-separator",
    );
    const iconRule = getCssRuleBlock(
      fileViewPanelCss,
      ".fvp-file-context-menu .renderer-context-menu-item-icon",
    );
    const iconSvgRule = getCssRuleBlock(
      fileViewPanelCss,
      ".fvp-file-context-menu .renderer-context-menu-item-icon svg",
    );
    const webkitScrollbarRule = getCssRuleBlock(
      fileViewPanelCss,
      ".fvp-file-context-menu::-webkit-scrollbar",
    );

    expect(menuRule).toContain("overflow-y: auto;");
    expect(menuRule).toContain("padding: 5px;");
    expect(menuRule).toContain("scrollbar-width: none;");
    expect(menuRule).toContain("-ms-overflow-style: none;");
    expect(itemRule).toContain("min-height: 30px;");
    expect(itemRule).toContain("padding: 5px 8px;");
    expect(separatorRule).toContain("margin: 4px 5px;");
    expect(iconRule).toContain("width: 14px;");
    expect(iconRule).toContain("height: 14px;");
    expect(iconRule).toContain("flex-basis: 14px;");
    expect(iconSvgRule).toContain("width: 14px;");
    expect(iconSvgRule).toContain("height: 14px;");
    expect(webkitScrollbarRule).toContain("display: none;");
  });

  it("keeps file navigation and tabs in one header row without legacy toolbar CSS", () => {
    const headerRule = getCssRuleBlock(fileViewPanelCss, ".fvp-header-row");

    expect(headerRule).toContain("display: flex;");
    expect(headerRule).toContain("align-items: center;");
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-topbar")).toBe("");
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-action-group")).toBe("");
  });

  it("keeps the goto-line dialog compact", () => {
    const dialogRule = getCssRuleBlock(fileViewPanelCss, ".fvp-goto-line-dialog");
    const inputRule = getCssRuleBlock(fileViewPanelCss, ".fvp-goto-line-dialog input");

    expect(dialogRule).toContain("width: min(348px, calc(100% - 16px));");
    expect(dialogRule).toContain("padding: 12px;");
    expect(inputRule).toContain("height: 32px;");
  });

  it("keeps annotation cards compact with unified small action buttons", () => {
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-annotation-draft")).toContain(
      "border-radius: 8px;",
    );
    expect(getCssRuleBlock(diffViewerCss, ".diff-annotation-draft")).toContain(
      "border-radius: 8px;",
    );
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-annotation-submit")).toContain(
      "min-height: 28px;",
    );
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-annotation-submit")).toContain(
      "border-radius: 8px;",
    );
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-annotation-draft-actions button")).toContain(
      "min-height: 28px;",
    );
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-annotation-draft-actions button")).toContain(
      "border-radius: 8px;",
    );
    expect(getCssRuleBlock(fileViewPanelCss, ".fvp-annotation-submit")).toContain(
      "background: var(--surface-panel);",
    );
    expect(getCssRuleBlock(diffViewerCss, ".diff-annotation-draft-actions button")).toContain(
      "min-height: 28px;",
    );
    expect(getCssRuleBlock(diffViewerCss, ".diff-annotation-draft-actions button")).toContain(
      "border-radius: 8px;",
    );
    expect(
      getCssRuleBlock(diffViewerCss, ".diff-annotation-draft-actions button:not(.ghost)"),
    ).toContain("background: color-mix(in srgb, var(--surface-panel) 96%, transparent);");
  });

  it("keeps the markdown outline flyout subordinate to the document", () => {
    const outlineRule = getCssRuleBlock(
      fileViewPanelCss,
      ".fvp-markdown-outline-layer .fvp-preview-outline",
    );
    const outlineButtonRule = getCssRuleBlock(fileViewPanelCss, ".fvp-preview-outline-button");
    const pinButtonRule = getCssRuleBlock(fileViewPanelCss, ".fvp-preview-outline-pin-button");
    const pinIconRule = getCssRuleBlock(fileViewPanelCss, ".fvp-preview-outline-pin-icon");

    expect(outlineRule).toContain("width: min(320px, calc(100% - 40px));");
    expect(outlineRule).toContain("max-height: min(520px, calc(100% - 40px));");
    expect(outlineButtonRule).toContain("font-size: 13px;");
    expect(pinButtonRule).toContain("color: var(--fvp-reader-muted);");
    expect(pinIconRule).toContain("width: 18px;");
    expect(pinIconRule).toContain("height: 18px;");
  });

  it("uses README-style readable blue links in file markdown", () => {
    const linkRule = getCssRuleBlock(fileViewPanelCss, ".fvp-file-markdown :where(a)");

    expect(linkRule).toContain("color: var(--fvp-markdown-link, #0969da);");
    expect(linkRule).toContain("text-underline-offset: 0.14em;");
  });

  it("keeps markdown annotation drafts out of document flow", () => {
    const activeBlockRule = getCssRuleBlock(
      fileViewPanelCss,
      ".fvp-markdown-annotatable-block:has(.fvp-markdown-annotation-popover)",
    );
    const popoverRule = getCssRuleBlock(fileViewPanelCss, ".fvp-markdown-annotation-popover");
    const draftRule = getCssRuleBlock(fileViewPanelCss, ".fvp-annotation-draft");
    const inputRule = getCssRuleBlock(fileViewPanelCss, ".fvp-annotation-draft-input");

    expect(activeBlockRule).toContain("z-index: 20;");
    expect(popoverRule).toContain("position: absolute;");
    // Draft popover hugs the top-right "annotate" button instead of the block bottom.
    expect(popoverRule).toContain("top: 32px;");
    expect(popoverRule).toContain("right: 0;");
    expect(popoverRule).toContain("z-index: 20;");
    expect(popoverRule).toContain("pointer-events: auto;");
    expect(popoverRule).toContain("background: var(--bg-primary);");
    expect(draftRule).toContain("background: var(--bg-primary);");
    expect(inputRule).toContain("background: var(--bg-primary);");
  });
});
