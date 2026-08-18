import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const experienceCss = readFileSync(
  new URL("./account-experience.css", import.meta.url),
  "utf8",
);
const configurationCss = readFileSync(
  new URL("./account-configuration-dialog.css", import.meta.url),
  "utf8",
);
const experienceSource = readFileSync(
  new URL("./AccountExperience.tsx", import.meta.url),
  "utf8",
);
const centerSource = readFileSync(
  new URL("./AccountCenter.tsx", import.meta.url),
  "utf8",
);
const previewSource = readFileSync(
  new URL("./AccountPreviewSettingsSection.tsx", import.meta.url),
  "utf8",
);
const accountCopySource = readFileSync(
  new URL("../locale/accountExperienceCopy.ts", import.meta.url),
  "utf8",
);
const usageSource = readFileSync(
  new URL("./AccountUsagePanel.tsx", import.meta.url),
  "utf8",
);
const securitySource = readFileSync(
  new URL("./AccountSecurityPanel.tsx", import.meta.url),
  "utf8",
);

describe("Account visual contract", () => {
  it("keeps the configuration surface opaque and free of backdrop blur", () => {
    expect(configurationCss).toMatch(
      /\.account-config-dialog\s*\{[^}]*background:\s*var\(--popover\)\s*!important/s,
    );
    expect(configurationCss).toMatch(
      /\.account-config-dialog\s*\{[^}]*opacity:\s*1\s*!important/s,
    );
    expect(configurationCss).not.toMatch(/backdrop-filter/);
  });

  it("keeps help content adaptive instead of fixing tooltip dimensions", () => {
    const tooltipRule = experienceCss.match(/\.account-help-tooltip\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(tooltipRule).toMatch(/width:\s*max-content/);
    expect(tooltipRule).toMatch(/max-width:\s*min\(/);
    expect(tooltipRule).toMatch(/height:\s*auto/);
  });

  it("keeps the unavailable state compact and does not restyle its help trigger as an action", () => {
    const unavailableRule = experienceCss.match(
      /\.account-experience-state--warning\s*\{[^}]*\}/s,
    )?.[0] ?? "";
    expect(unavailableRule).toMatch(/grid-template-columns:/);
    expect(unavailableRule).toMatch(/min-height:\s*0/);
    expect(unavailableRule).not.toMatch(/flex-direction:\s*column/);
    expect(experienceCss).not.toMatch(/\.account-experience-state button\s*\{/);
  });

  it("uses the Codex engine mark and the host theme instead of mixing product identities", () => {
    expect(centerSource).toContain('<EngineIcon engine="codex"');
    expect(`${experienceSource}\n${centerSource}`).not.toContain("DOGE_PRODUCT_ICON_SRC");
    expect(`${experienceSource}\n${centerSource}`).not.toContain("assets/icon.png");
    expect(experienceCss).not.toMatch(/--account-accent|#ca5b2e|#b64b22/);
  });

  it("reuses the shared tabs primitive instead of a feature-local tab implementation", () => {
    expect(experienceSource).toContain("TabsList");
    expect(experienceSource).toContain("TabsTab");
    expect(experienceCss).not.toMatch(/button\.active::after/);
  });

  it("keeps preview controls behind the Gateway instead of rendering a test toolbar", () => {
    expect(previewSource).toContain("createProductPreviewAccountGatewayV1");
    expect(previewSource).not.toMatch(/<select|体验场景|交互预览|ACCOUNT_FRONTEND_SCENARIOS_V1/);
    expect(experienceCss).not.toMatch(/account-ui-preview-toolbar/);
  });

  it("does not introduce a pay-as-you-go mental model in account product copy", () => {
    expect(accountCopySource).not.toMatch(/按量付费|pay\s+as\s+you\s+go/i);
  });

  it("keeps zero-usage days visible without an explanatory heatmap legend", () => {
    const usageDayRule = experienceCss.match(/\.account-usage-day\s*\{[^}]*background:[^}]*\}/s)?.[0] ?? "";
    expect(usageDayRule).toContain("var(--surface-card-muted, var(--muted))");
    expect(usageDayRule).not.toContain("var(--surface-muted)");
    expect(usageSource).not.toContain("account-usage-heatmap-legend");
    expect(accountCopySource).not.toMatch(/usageLess|usageMore/);
  });

  it("keeps Account Center actions quiet and subscription cards bounded to three columns", () => {
    const headerActionRule = experienceCss.match(
      /\.account-header-icon-button\s*\{[^}]*\}/s,
    )?.[0] ?? "";
    expect(headerActionRule).toContain("border: 0");
    expect(headerActionRule).toContain("background: transparent");
    expect(experienceCss).toContain('.account-usage-engine-list[data-columns="3"]');
    expect(experienceCss).toContain("grid-template-columns: repeat(3, minmax(0, 1fr))");
    expect(experienceCss).toContain('@media (min-width: 681px) and (max-width: 860px)');
    expect(usageSource).not.toContain("<h3>{copy.usage}</h3>");
    expect(securitySource).not.toContain("<h3>{copy.security}</h3>");
  });
});
