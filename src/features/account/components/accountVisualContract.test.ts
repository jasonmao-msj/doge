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
const previewSource = readFileSync(
  new URL("./AccountPreviewSettingsSection.tsx", import.meta.url),
  "utf8",
);
const accountCopySource = readFileSync(
  new URL("../locale/accountExperienceCopy.ts", import.meta.url),
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
    expect(experienceSource).toContain('<EngineIcon engine="codex"');
    expect(experienceSource).not.toContain("DOGE_PRODUCT_ICON_SRC");
    expect(experienceSource).not.toContain("assets/icon.png");
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
});
