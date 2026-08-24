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
const gateCss = readFileSync(
  new URL("./account-app-gate.css", import.meta.url),
  "utf8",
);
const experienceSource = readFileSync(
  new URL("./AccountExperience.tsx", import.meta.url),
  "utf8",
);
const helpTooltipSource = readFileSync(
  new URL("./AccountHelpTooltip.tsx", import.meta.url),
  "utf8",
);
const centerSource = readFileSync(
  new URL("./AccountCenter.tsx", import.meta.url),
  "utf8",
);
const headerSource = readFileSync(
  new URL("./AccountCenterHeader.tsx", import.meta.url),
  "utf8",
);
const productDetailsSource = readFileSync(
  new URL("./ProductAccountDetails.tsx", import.meta.url),
  "utf8",
);
const subscriptionSource = readFileSync(
  new URL("./AccountSubscriptionPanel.tsx", import.meta.url),
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
const gateViewsSource = readFileSync(
  new URL("./AccountAppGateViews.tsx", import.meta.url),
  "utf8",
);
const legacyGateSource = readFileSync(
  new URL("./AccountAppGate.tsx", import.meta.url),
  "utf8",
);
const productGateSource = readFileSync(
  new URL("./ProductAccountAppGate.tsx", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL("../../settings/components/SettingsView.tsx", import.meta.url),
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
    expect(helpTooltipSource).toContain("ACCOUNT_HELP_TOOLTIP_Z_INDEX = 10_020");
    expect(helpTooltipSource).toContain("style={{ zIndex: ACCOUNT_HELP_TOOLTIP_Z_INDEX }}");
    expect(gateCss).toMatch(/\.account-app-gate\s*\{[^}]*z-index:\s*10000/s);
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

  it("keeps expanded account failure details readable for multiline diagnostics", () => {
    const detailsRule = experienceCss.match(
      /\.account-failure-details\s*\{[^}]*\}/s,
    )?.[0] ?? "";
    expect(detailsRule).toMatch(/grid-column:\s*2\s*\/\s*-1/);
    expect(detailsRule).toMatch(/max-height:\s*min\(/);
    expect(detailsRule).toMatch(/overflow:\s*auto/);
    expect(helpTooltipSource).toContain('aria-expanded={expanded}');
    expect(experienceSource).toContain("controller.failure.recovery.action");
  });

  it("uses the product avatar only for account identity and keeps usage icons domain-specific", () => {
    expect(subscriptionSource).toContain('subscription.engineId === "claude-code" ? "claude" : "codex"');
    expect(headerSource).toContain("doge-mascot-avatar.png");
    expect(`${experienceSource}\n${centerSource}\n${subscriptionSource}\n${productDetailsSource}`).not.toContain("assets/icon.png");
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

  it("keeps Account Center actions quiet and renders one progressive product detail page", () => {
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
    expect(headerSource).toContain("MoreHorizontal");
    expect(headerSource).toContain("aria-label={copy.security}");
    expect(headerSource).not.toContain("ShieldCheck");
    expect(centerSource).toContain("ProductAccountDetails");
    expect(centerSource).not.toContain("<Tabs");
    expect(productDetailsSource).toContain("account-usage-stat-grid");
    expect(productDetailsSource).toContain("account-billing-list");
    expect(productDetailsSource).toContain("account-subscription-model-groups");
    expect(productDetailsSource).toContain("account-subscription-model-group-trigger");
    expect(productDetailsSource).toContain("account-subscription-model-list");
    expect(productDetailsSource).toContain("aria-expanded={expanded}");
    expect(productDetailsSource).not.toMatch(/invoice-download|下载账单/);
    expect(productDetailsSource).not.toContain("accountBillingDownloadUnavailable");
    expect(accountCopySource).not.toMatch(/发票|invoice/i);
    expect(productDetailsSource).toContain("<Tooltip delayDuration={0}>");
    expect(settingsSource).toContain('activeSection !== "account" ? (');
    expect(experienceCss).toContain(".account-profile-card");
    expect(experienceCss).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
  });

  it("loads gate styles from the shared view owner and bounds the logo before CSS settles", () => {
    expect(gateViewsSource).toContain('import "./account-app-gate.css"');
    expect(gateViewsSource).toContain("width={54}");
    expect(gateViewsSource).toContain("height={54}");
    expect(legacyGateSource).not.toContain('import "./account-app-gate.css"');
    expect(productGateSource).not.toContain('import "./account-app-gate.css"');
  });

  it("keeps the product plan as a structured card with a full-width CTA", () => {
    expect(productGateSource).toContain("account-product-plan-head");
    expect(productGateSource).toContain("account-product-plan-lines");
    expect(productGateSource).toContain("account-product-plan-cta");
    expect(gateCss).toMatch(/\.account-product-plan\s*\{[^}]*border:[^}]*border-radius:/s);
    expect(gateCss).toMatch(/\.account-product-plan-line\s*\{[^}]*grid-template-columns:/s);
    expect(gateCss).toMatch(/\.account-product-plan-cta\s*\{[^}]*width:\s*100%/s);
  });
});
