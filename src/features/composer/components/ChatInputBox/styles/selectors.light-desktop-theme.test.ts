import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

const selectorsCss = normalizeLineEndings(
  readFileSync(
    fileURLToPath(new URL("./selectors.css", import.meta.url)),
    "utf8",
  ),
);

describe("selector light desktop theme guards", () => {
  it("normalizes Windows CSS line endings before exact source assertions", () => {
    expect(normalizeLineEndings("selector {\r\n  color: red;\r\n}\r\n")).toBe(
      "selector {\n  color: red;\n}\n",
    );
  });

  it("applies the same light dropdown surface style to all desktop platforms", () => {
    expect(selectorsCss).toContain(
      ':root[data-theme="light"] .app.layout-desktop .selector-dropdown',
    );
    expect(selectorsCss).not.toContain(
      ':root[data-theme="light"] .app.windows-desktop .selector-dropdown',
    );
  });

  it("keeps system-light desktop path aligned with explicit light theme", () => {
    expect(selectorsCss).toContain(
      ':root:not([data-theme]) .app.layout-desktop .selector-dropdown',
    );
    expect(selectorsCss).toContain(
      ':root:not([data-theme]) .app.layout-desktop .selector-option.disabled',
    );
  });

  it("uses the same disabled opacity baseline for light and system-light desktop selectors", () => {
    const opacityMatches = selectorsCss.match(/opacity:\s*0\.68;/g) ?? [];
    expect(opacityMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps selected options driven by selected foreground/background tokens", () => {
    expect(selectorsCss).toContain(
      "background: var(--dropdown-selected, var(--dropdown-hover-color, #EDEEF1));",
    );
    expect(selectorsCss).toContain(
      "color: var(--dropdown-selected-text, var(--dropdown-text-color, #0D0D0D));",
    );
  });

  it("keeps tool-popover icon actions square while labeled actions may expand", () => {
    expect(selectorsCss).toMatch(
      /\.composer-tool-menu-surface-row \.context-tool-btn \{[\s\S]*?width: 34px;[\s\S]*?height: 34px;[\s\S]*?padding: 0;/,
    );
    expect(selectorsCss).toMatch(
      /\.composer-tool-menu-surface-row \.context-tool-btn--labeled \{[\s\S]*?width: auto;[\s\S]*?padding: 0 9px;/,
    );
  });

  it("keeps the tool popover vertical rhythm compact", () => {
    expect(selectorsCss).toMatch(
      /\.composer-tool-menu \{[\s\S]*?padding: 4px;/,
    );
    expect(selectorsCss).toContain('.composer-tool-menu > [role="separator"] {\n  margin: 1px -4px;');
    expect(selectorsCss).toContain(
      '.composer-tool-menu > [data-slot="dropdown-menu-item"] {\n  padding-top: 4px;\n  padding-bottom: 4px;',
    );
    expect(selectorsCss).toMatch(
      /\.composer-tool-menu-sub-trigger \{[\s\S]*?min-height: 32px;[\s\S]*?padding: 4px 8px;/,
    );
    expect(selectorsCss).toMatch(
      /\.composer-tool-menu-surface-row \{[\s\S]*?padding: 0 2px 2px;/,
    );
  });

  it("defines session control HUD dual-pane layout with theme tokens", () => {
    expect(selectorsCss).toContain(".composer-session-control-hud");
    expect(selectorsCss).toContain(".composer-session-hud-main");
    expect(selectorsCss).toContain(".composer-session-hud-quota");
    expect(selectorsCss).toContain(
      "width: var(--composer-session-hud-width, 100%);",
    );
    expect(selectorsCss).toContain(
      "background: var(--composer-tool-popover-bg, var(--dropdown-bg, #1f2028)) !important;",
    );
  });
});
