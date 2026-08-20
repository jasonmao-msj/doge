// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  buildSessionOverview,
  buildSessionOverviewQuota,
} from "./sessionOverviewViewModel";

const userMessage = (id: string): ConversationItem =>
  ({
    kind: "message",
    id,
    role: "user",
    text: "hi",
  }) as ConversationItem;

const assistantMessage = (id: string): ConversationItem =>
  ({
    kind: "message",
    id,
    role: "assistant",
    text: "hello",
  }) as ConversationItem;

describe("buildSessionOverviewQuota", () => {
  it("uses official_cli rate limits for codex official route", () => {
    const quota = buildSessionOverviewQuota(
      "codex",
      {
        primary: {
          usedPercent: 40,
          windowDurationMins: 300,
          resetsAt: 1_800_000_100,
        },
        secondary: {
          usedPercent: 10,
          windowDurationMins: 10_080,
          resetsAt: null,
        },
        credits: { hasCredits: true, unlimited: false, balance: "12.5" },
        planType: "plus",
      },
      true,
      { source: "codex", success: true, windows: [] },
    );

    expect(quota.source).toBe("official_cli");
    expect(quota.windows).toHaveLength(2);
    expect(quota.windows[0]).toMatchObject({
      id: "primary",
      displayPercent: 60,
      usedPercent: 40,
      label: "5h limit",
    });
    expect(quota.windows[1]).toMatchObject({
      id: "secondary",
      displayPercent: 90,
      usedPercent: 10,
      label: "Weekly limit",
    });
    expect(quota.creditsBalance).toBe("12.5");
    expect(quota.planType).toBe("plus");
  });

  it("prefers coding-plan over codex rateLimits when provider is minimax", () => {
    const quota = buildSessionOverviewQuota(
      "codex",
      {
        primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: null },
        secondary: null,
        credits: null,
        planType: "plus",
      },
      false,
      {
        source: "minimax",
        success: true,
        windows: [
          {
            id: "five_hour",
            usedPercent: 1,
            remainingPercent: 99,
            resetsAt: null,
          },
        ],
      },
    );

    expect(quota.source).toBe("coding_plan");
    expect(quota.providerLabel).toBe("minimax");
    expect(quota.windows[0]?.usedPercent).toBe(1);
    expect(quota.windows[0]?.displayPercent).toBe(1);
  });

  it("does not attach codex rate limits to kimi without coding-plan data", () => {
    const quota = buildSessionOverviewQuota(
      "kimi",
      {
        primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: null },
        secondary: null,
        credits: null,
        planType: "plus",
      },
      false,
      null,
    );

    expect(quota.source).toBe("empty");
    expect(quota.windows).toEqual([]);
    expect(quota.planType).toBeNull();
  });

  it("maps coding-plan windows for kimi/minimax style payloads on claude", () => {
    const quota = buildSessionOverviewQuota("claude", null, true, {
      source: "minimax",
      success: true,
      windows: [
        {
          id: "five_hour",
          usedPercent: 1,
          remainingPercent: 99,
          resetsAt: "2026-08-02T12:00:00Z",
        },
        {
          id: "weekly_limit",
          usedPercent: 11,
          remainingPercent: 89,
          resetsAt: null,
        },
      ],
    });

    expect(quota.source).toBe("coding_plan");
    expect(quota.providerLabel).toBe("minimax");
    expect(quota.windows[0]).toMatchObject({
      id: "five_hour",
      label: "5小时",
      displayPercent: 99,
      usedPercent: 1,
    });
    expect(quota.windows[1]?.displayPercent).toBe(89);
  });

  it("hides quota for official claude none route", () => {
    const quota = buildSessionOverviewQuota("claude", null, false, {
      source: "none",
      success: true,
      windows: [],
    });
    expect(quota.source).toBe("none");
    expect(quota.windows).toEqual([]);
  });

  it("maps deepseek balance without windows and does not use codex rateLimits", () => {
    const quota = buildSessionOverviewQuota(
      "codex",
      {
        primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: null },
        secondary: null,
        credits: { hasCredits: true, unlimited: false, balance: "999" },
        planType: "plus",
      },
      true,
      {
        source: "deepseek",
        success: true,
        planLabel: "available",
        windows: [],
        balance: {
          isAvailable: true,
          items: [
            {
              currency: "CNY",
              totalBalance: "110.00",
              grantedBalance: "10.00",
              toppedUpBalance: "100.00",
            },
            {
              currency: "USD",
              totalBalance: "1.50",
            },
          ],
        },
      },
    );

    expect(quota.source).toBe("coding_plan");
    expect(quota.providerLabel).toBe("deepseek");
    expect(quota.windows).toEqual([]);
    expect(quota.hasCredits).toBe(true);
    expect(quota.creditsBalance).toBe("CNY 110.00 · USD 1.50");
    expect(quota.planType).toBe("available");
    // 不得用 Codex 官方 90% 窗口冒充
    expect(quota.windows).toHaveLength(0);
  });

  it("maps deepseek auth failure to error without unsupported host", () => {
    const quota = buildSessionOverviewQuota("codex", null, false, {
      source: "deepseek",
      success: false,
      error: "Authentication failed (HTTP 401 Unauthorized)",
      windows: [],
    });
    expect(quota.source).toBe("error");
    expect(quota.error).toMatch(/Authentication failed/);
    expect(quota.hasCredits).toBe(false);
  });
});

describe("buildSessionOverview multi quota entries", () => {
  it("keeps separate quota cards for shared-session providers", () => {
    const overview = buildSessionOverview({
      sessionId: "shared:1",
      engine: "claude",
      model: "MiniMax-M3",
      workspaceName: "demo",
      workspacePath: "/tmp/demo",
      sessionDiskPath: null,
      isProcessing: false,
      threadStatus: null,
      items: [],
      tokenUsage: null,
      rateLimits: null,
      usageShowRemaining: false,
      nowMs: 0,
      quotaEntries: [
        {
          key: "claude::local",
          title: "Claude · 本地配置",
          subtitle: "k3",
          engine: "claude",
          providerProfileId: "local",
          codingPlanQuota: { source: "none", success: true, windows: [] },
        },
        {
          key: "claude::minimax",
          title: "Claude · Minimax-m3",
          subtitle: "MiniMax-M3",
          engine: "claude",
          providerProfileId: "minimax",
          codingPlanQuota: {
            source: "minimax",
            success: true,
            windows: [
              {
                id: "five_hour",
                usedPercent: 1,
                remainingPercent: 99,
              },
              {
                id: "weekly_limit",
                usedPercent: 11,
                remainingPercent: 89,
              },
            ],
          },
        },
      ],
    });

    expect(overview.engineLine).toContain("本地配置");
    expect(overview.engineLine).toContain("Minimax-m3");
    // 官方 Claude none 被过滤，仅保留 minimax 套餐卡
    expect(overview.quotaEntries).toHaveLength(1);
    expect(overview.quotaEntries[0]?.title).toBe("Claude · Minimax-m3");
    expect(overview.quotaEntries[0]?.quota.windows).toHaveLength(2);
  });

  it("keeps deepseek balance card separate from minimax windows in shared multi-entry", () => {
    const overview = buildSessionOverview({
      sessionId: "shared:2",
      engine: "codex",
      model: "deepseek-v4-flash",
      workspaceName: "demo",
      workspacePath: "/tmp/demo",
      sessionDiskPath: null,
      isProcessing: false,
      threadStatus: null,
      items: [],
      tokenUsage: null,
      rateLimits: null,
      usageShowRemaining: true,
      nowMs: 0,
      quotaEntries: [
        {
          key: "codex::deepseek",
          title: "Codex · DeepSeek",
          subtitle: "deepseek-v4-flash",
          engine: "codex",
          providerProfileId: "deepseek",
          codingPlanQuota: {
            source: "deepseek",
            success: true,
            windows: [],
            balance: {
              isAvailable: true,
              items: [{ currency: "CNY", totalBalance: "42.00" }],
            },
          },
        },
        {
          key: "claude::minimax",
          title: "Claude · Minimax-m3",
          subtitle: "MiniMax-M3",
          engine: "claude",
          providerProfileId: "minimax",
          codingPlanQuota: {
            source: "minimax",
            success: true,
            windows: [
              {
                id: "five_hour",
                usedPercent: 1,
                remainingPercent: 99,
              },
            ],
          },
        },
      ],
    });

    expect(overview.quotaEntries).toHaveLength(2);
    const deepseek = overview.quotaEntries.find((e) =>
      e.key.includes("deepseek"),
    );
    const minimax = overview.quotaEntries.find((e) =>
      e.key.includes("minimax"),
    );
    expect(deepseek?.quota.source).toBe("coding_plan");
    expect(deepseek?.quota.providerLabel).toBe("deepseek");
    expect(deepseek?.quota.hasCredits).toBe(true);
    expect(deepseek?.quota.creditsBalance).toBe("CNY 42.00");
    expect(deepseek?.quota.windows).toEqual([]);
    expect(minimax?.quota.windows).toHaveLength(1);
    expect(minimax?.quota.hasCredits).toBe(false);
  });
});

describe("buildSessionOverview", () => {
  it("derives status, identity, path and codex quota fields", () => {
    const overview = buildSessionOverview({
      sessionId: "thread-abc",
      engine: "codex",
      model: "gpt-5",
      workspaceName: "mossx",
      workspacePath: "/tmp/mossx",
      sessionDiskPath: "/Users/dev/.codex/sessions/2026/thread-abc.jsonl",
      isProcessing: true,
      threadStatus: {
        isProcessing: true,
        processingStartedAt: 1_000,
      },
      items: [userMessage("u1"), assistantMessage("a1"), userMessage("u2")],
      tokenUsage: {
        contextUsedPercent: 42.6,
        contextUsedTokens: 12_000,
        modelContextWindow: 200_000,
      } as never,
      rateLimits: {
        primary: { usedPercent: 18.2, windowDurationMins: 300, resetsAt: null },
        secondary: null,
        credits: null,
        planType: null,
      },
      usageShowRemaining: false,
      codingPlanQuota: null,
      nowMs: 4_000,
    });

    expect(overview).toMatchObject({
      sessionId: "thread-abc",
      engine: "codex",
      model: "gpt-5",
      workspaceLabel: "mossx",
      workspacePath: "/tmp/mossx",
      sessionDiskPath: "/Users/dev/.codex/sessions/2026/thread-abc.jsonl",
      status: "running",
      durationMs: 3_000,
      messageCount: 3,
      turnCount: 2,
      contextUsedPercent: 43,
      contextUsedTokens: 12_000,
      modelContextWindow: 200_000,
      hasAnyContent: true,
    });
    expect(overview.quota.source).toBe("official_cli");
    expect(overview.quota.windows[0]?.displayPercent).toBe(18);
  });

  it("keeps full workspace path when name is missing", () => {
    const overview = buildSessionOverview({
      sessionId: null,
      engine: null,
      model: null,
      workspaceName: null,
      workspacePath: "/Users/demo/project",
      sessionDiskPath: null,
      isProcessing: false,
      threadStatus: {
        lastDurationMs: 1_500,
      },
      items: [],
      tokenUsage: null,
      rateLimits: null,
      usageShowRemaining: false,
      codingPlanQuota: null,
      nowMs: 10_000,
    });

    expect(overview.workspaceLabel).toBe("project");
    expect(overview.workspacePath).toBe("/Users/demo/project");
    expect(overview.status).toBe("idle");
    expect(overview.durationMs).toBe(1_500);
    expect(overview.hasAnyContent).toBe(true);
  });

  it("renders empty-state when no identity or stats exist", () => {
    const overview = buildSessionOverview({
      sessionId: null,
      engine: null,
      model: null,
      workspaceName: null,
      workspacePath: null,
      sessionDiskPath: null,
      isProcessing: false,
      threadStatus: null,
      items: [],
      tokenUsage: null,
      rateLimits: null,
      usageShowRemaining: false,
      codingPlanQuota: null,
      nowMs: 0,
    });

    expect(overview.hasAnyContent).toBe(false);
    expect(overview.status).toBe("idle");
  });

  it("clamps percents and marks compacting", () => {
    const overview = buildSessionOverview({
      sessionId: "s1",
      engine: "codex",
      model: "gpt",
      workspaceName: "demo",
      workspacePath: null,
      sessionDiskPath: null,
      isProcessing: true,
      threadStatus: {
        isContextCompacting: true,
        processingStartedAt: 100,
      },
      items: [userMessage("u1")],
      tokenUsage: {
        contextUsedPercent: 140,
      } as never,
      rateLimits: {
        primary: { usedPercent: -5, windowDurationMins: null, resetsAt: null },
        secondary: null,
        credits: null,
        planType: null,
      },
      usageShowRemaining: false,
      codingPlanQuota: null,
      nowMs: 200,
    });

    expect(overview.status).toBe("compacting");
    expect(overview.durationMs).toBe(100);
    expect(overview.contextUsedPercent).toBe(100);
    expect(overview.quota.windows[0]?.displayPercent).toBe(0);
  });
});
