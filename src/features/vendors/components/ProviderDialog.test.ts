import { describe, expect, it } from "vitest";
import enSettings from "../../../i18n/locales/en/settings";
import zhSettings from "../../../i18n/locales/zh/settings";
import { defaultConfigJson } from "./ProviderDialog";

describe("ProviderDialog defaultConfigJson", () => {
  it("includes the full Claude provider settings template", () => {
    const config = JSON.parse(defaultConfigJson()) as {
      alwaysThinkingEnabled?: boolean;
      autoDreamEnabled?: boolean;
      cleanupPeriodDays?: number;
      effortLevel?: string;
      env?: Record<string, string>;
      hasCompletedOnboarding?: boolean;
      language?: string;
      model?: string;
      skipAutoPermissionPrompt?: boolean;
      teammateMode?: string;
      tui?: string;
    };

    expect(config).toMatchObject({
      alwaysThinkingEnabled: true,
      autoDreamEnabled: true,
      cleanupPeriodDays: 720,
      effortLevel: "xhigh",
      hasCompletedOnboarding: true,
      language: "\u7b80\u4f53\u4e2d\u6587",
      model: "opus",
      skipAutoPermissionPrompt: true,
      teammateMode: "in-process",
      tui: "fullscreen",
    });
    expect(config.env).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_BASE_URL: "",
      ANTHROPIC_BETAS: "context-1m-2025-08-07",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5-20251001",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
      ANTHROPIC_SMALL_FAST_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      CLAUDE_CODE_NEW_INIT: "1",
      DISABLE_ERROR_REPORTING: "1",
      DISABLE_TELEMETRY: "1",
      ENABLE_TOOL_SEARCH: "1",
      MAX_THINKING_TOKENS: "31999",
      MCP_TIMEOUT: "60000",
    });
  });

  it("describes managed providers as isolated from the global Claude settings", () => {
    const enDialog = enSettings.settings.vendor.dialog;
    const zhDialog = zhSettings.settings.vendor.dialog;

    expect(enDialog.addDescription).toContain("stored separately in doge");
    expect(enDialog.editDescription).toContain(
      "~/.claude/settings.json is not modified",
    );
    expect(zhDialog.addDescription).toContain("独立存储在 doge");
    expect(zhDialog.editDescription).toContain(
      "不会修改 ~/.claude/settings.json",
    );
  });
});
