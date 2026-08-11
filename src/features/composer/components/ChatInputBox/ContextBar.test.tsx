// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextBar } from "./ContextBar";

describe("ContextBar live canvas controls visibility", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.removeItem("doge.messages.live.autoFollow");
    window.localStorage.setItem("doge.messages.live.collapseMiddleSteps", "0");
  });

  it("hides live canvas controls in history mode (phase collapse is automatic)", () => {
    const { container } = render(
      <ContextBar
        isLoading={false}
        hasMessages
        showStatusPanelToggle
      />,
    );

    // Focus-follow only appears while loading; output-collapse toggle was removed.
    expect(container.querySelector(".context-live-canvas-controls")).toBeNull();
    expect(container.querySelector(".context-live-canvas-btn--focus-follow")).toBeNull();
  });

  it("hides live canvas controls when idle and no messages", () => {
    const { container } = render(
      <ContextBar
        isLoading={false}
        hasMessages={false}
        showStatusPanelToggle
      />,
    );

    expect(container.querySelector(".context-live-canvas-controls")).toBeNull();
  });

  it("external surface keeps context chips outside while moving action tools away", () => {
    const { container } = render(
      <ContextBar
        surface="external"
        activeFile="/workspace/src/App.tsx"
        selectedContextChips={[{ type: "skill", name: "ui-design" }]}
        isLoading={false}
        hasMessages
        currentProvider="codex"
        onAddAttachment={vi.fn()}
        onRewind={vi.fn()}
        showRewindEntry
        showStatusPanelToggle
        onToggleStatusPanel={vi.fn()}
      />,
    );

    expect(screen.getByText("ui-design")).toBeTruthy();
    expect(screen.getByText("App.tsx")).toBeTruthy();
    expect(screen.queryByText("statusPanel.label")).toBeNull();
    expect(container.querySelector(".context-tool-btn .codicon-attach")).toBeNull();
    expect(container.querySelector(".context-live-canvas-controls")).toBeNull();
    expect(container.querySelector(".context-rewind-btn")).toBeNull();
  });

  it("disables rewind while conversation is in progress", () => {
    const onRewind = vi.fn();
    const { container } = render(
      <ContextBar
        isLoading
        hasMessages
        currentProvider="claude"
        onRewind={onRewind}
        showRewindEntry
      />,
    );

    const rewindButton = container.querySelector(".context-rewind-btn") as HTMLButtonElement | null;

    expect(rewindButton).toBeTruthy();
    expect(rewindButton?.hasAttribute("disabled")).toBe(true);

    rewindButton?.click();
    expect(onRewind).not.toHaveBeenCalled();
  });

  it("shows rewind for codex provider when enabled", () => {
    const { container } = render(
      <ContextBar
        isLoading={false}
        hasMessages
        currentProvider="codex"
        onRewind={vi.fn()}
        showRewindEntry
      />,
    );

    const rewindButton = container.querySelector(".context-rewind-btn");
    expect(rewindButton).toBeTruthy();
  });

  it("keeps rewind as an accessible icon-only quick action", () => {
    const { container } = render(
      <ContextBar
        isLoading={false}
        hasMessages
        currentProvider="codex"
        onRewind={vi.fn()}
        showRewindEntry
      />,
    );

    const rewindButton = screen.getByRole("button", { name: "rewind.tooltip" });

    expect(rewindButton.classList.contains("context-tool-btn--labeled")).toBe(false);
    expect(container.querySelector(".context-rewind-btn .context-tool-label")).toBeNull();
    // Global "输出折叠" control removed — phase collapse is automatic and causal.
    expect(screen.queryByRole("button", { name: /收起中间过程|展开中间过程/ })).toBeNull();
  });

  it("renders the completion email toggle in the bottom context bar", () => {
    const onToggleCompletionEmail = vi.fn();

    const { rerender } = render(
      <ContextBar
        isLoading={false}
        hasMessages
        onToggleCompletionEmail={onToggleCompletionEmail}
      />,
    );

    const toggle = screen.getByRole("button", {
      name: "composer.completionEmailAriaLabel",
    });
    expect(toggle.closest(".context-bar")).toBeTruthy();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    toggle.click();
    expect(onToggleCompletionEmail).toHaveBeenCalledTimes(1);

    rerender(
      <ContextBar
        isLoading={false}
        hasMessages
        completionEmailSelected
        completionEmailDisabled
        onToggleCompletionEmail={onToggleCompletionEmail}
      />,
    );

    const selectedToggle = screen.getByRole("button", {
      name: "composer.completionEmailSelected",
    }) as HTMLButtonElement;
    expect(selectedToggle.getAttribute("aria-pressed")).toBe("true");
    expect(selectedToggle.disabled).toBe(true);
  });

  it("renders Codex auto-compaction controls inside the context tooltip", () => {
    const onCodexAutoCompactionSettingsChange = vi.fn();

    const { rerender } = render(
      <ContextBar
        currentProvider="codex"
        contextDualViewEnabled
        dualContextUsage={{
          usedTokens: 50,
          contextWindow: 100,
          percent: 50,
          hasUsage: true,
          compactionState: "idle",
          compactionSource: null,
          usageSyncPendingAfterCompaction: false,
        }}
        codexAutoCompactionEnabled={false}
        codexAutoCompactionThresholdPercent={150}
        onCodexAutoCompactionSettingsChange={onCodexAutoCompactionSettingsChange}
      />,
    );

    const toggle = screen.getByLabelText("chat.contextDualViewAutoCompactionEnabled");
    const threshold = screen.getByLabelText("chat.contextDualViewAutoCompactionThreshold") as HTMLSelectElement;

    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(threshold.value).toBe("150");
    expect(threshold.disabled).toBe(true);

    fireEvent.click(toggle);
    expect(onCodexAutoCompactionSettingsChange).toHaveBeenCalledWith({ enabled: true });

    rerender(
      <ContextBar
        currentProvider="codex"
        contextDualViewEnabled
        dualContextUsage={{
          usedTokens: 50,
          contextWindow: 100,
          percent: 50,
          hasUsage: true,
          compactionState: "idle",
          compactionSource: null,
          usageSyncPendingAfterCompaction: false,
        }}
        codexAutoCompactionEnabled
        codexAutoCompactionThresholdPercent={150}
        onCodexAutoCompactionSettingsChange={onCodexAutoCompactionSettingsChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("chat.contextDualViewAutoCompactionThreshold"), {
      target: { value: "180" },
    });
    expect(onCodexAutoCompactionSettingsChange).toHaveBeenCalledWith({ thresholdPercent: 180 });
  });

  it("shows the real Codex context usage percent while filling the ring at 100 percent", () => {
    const { container } = render(
      <ContextBar
        currentProvider="codex"
        contextDualViewEnabled
        dualContextUsage={{
          usedTokens: 130,
          contextWindow: 100,
          percent: 100,
          hasUsage: true,
          compactionState: "idle",
          compactionSource: null,
          usageSyncPendingAfterCompaction: false,
        }}
      />,
    );

    expect(screen.getAllByText("130%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("0%")).toBeTruthy();

    const summary = container.querySelector(".context-dual-usage");
    const percentage = summary?.querySelector(".context-dual-usage-percent");
    const ring = summary?.querySelector("svg");
    const progressCircle = ring?.querySelectorAll("circle")[1];

    expect(percentage?.nextElementSibling).toBe(ring);
    expect(progressCircle?.getAttribute("stroke-dashoffset")).toBe("0");
  });

  it("shows sync-pending copy after automatic compaction completes before usage refresh", () => {
    render(
      <ContextBar
        currentProvider="codex"
        contextDualViewEnabled
        dualContextUsage={{
          usedTokens: 140,
          contextWindow: 100,
          percent: 100,
          hasUsage: true,
          compactionState: "compacted",
          compactionSource: "auto",
          usageSyncPendingAfterCompaction: true,
        }}
      />,
    );

    expect(screen.getByText("chat.contextDualViewCompactedPendingSyncAuto")).toBeTruthy();
  });

  it("does not render unknown Claude context usage as zero percent", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ContextBar
        currentProvider="claude"
        percentage={null}
        claudeContextUsage={{
          usedTokens: null,
          contextWindow: null,
          totalTokens: null,
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          usedPercent: null,
          remainingPercent: null,
          freshness: "pending",
          source: null,
          hasUsage: false,
        }}
      />,
    );

    expect(screen.queryByText("0%")).toBeNull();

    const trigger = container.querySelector('[data-slot="hover-card-trigger"]');
    expect(trigger).toBeTruthy();
    await user.hover(trigger as Element);

    expect(await screen.findByText("chat.claudeContextUnavailable")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("renders Claude live context usage with Codex-like density but no compaction controls", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ContextBar
        currentProvider="claude"
        percentage={65}
        usedTokens={167_800}
        maxTokens={258_400}
        claudeContextUsage={{
          usedTokens: 167_800,
          contextWindow: 258_400,
          totalTokens: 570_400,
          inputTokens: 400_000,
          cachedInputTokens: 20_000,
          outputTokens: 150_400,
          usedPercent: 65,
          remainingPercent: 35,
          freshness: "live",
          source: "context_window",
          hasUsage: true,
          categoryUsages: [
            { name: "System prompt", tokens: 1_600, percent: 0.8 },
            { name: "Memory files", tokens: 6_700, percent: 3.3 },
          ],
          toolUsages: [
            { name: "mcp__one", server: "srv", tokens: 3_000 },
            { name: "mcp__two", server: "srv", tokens: 2_000 },
            { name: "mcp__three", server: "srv", tokens: 1_000 },
          ],
          toolUsagesTruncated: true,
        }}
      />,
    );

    await user.hover(container.querySelector('[data-slot="hover-card-trigger"]') as Element);

    // Header shows the context window occupancy (used / total).
    expect(await screen.findByText("168K / 258K")).toBeTruthy();
    // Trigger label + card header both surface the used percentage.
    expect(screen.getAllByText("65%").length).toBeGreaterThanOrEqual(2);
    // Card is header-only: no per-category usage rows or freshness footer.
    expect(screen.queryByText("chat.claudeContextInputLabel")).toBeNull();
    expect(screen.queryByText("chat.claudeContextCachedExcludedDetail")).toBeNull();
    expect(screen.queryByText("chat.claudeContextCategoryTitle")).toBeNull();
    expect(document.querySelector(".claude-context-category-grid")).toBeNull();
    expect(screen.queryByText("chat.claudeContextFreshness.live")).toBeNull();
    expect(screen.queryByLabelText("chat.contextDualViewAutoCompactionEnabled")).toBeNull();
  });

  it("labels Claude estimated window usage instead of waiting for CLI telemetry", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ContextBar
        currentProvider="claude"
        percentage={null}
        claudeContextUsage={{
          usedTokens: 266_100,
          contextWindow: null,
          totalTokens: 89_600,
          inputTokens: 88_600,
          cachedInputTokens: 177_500,
          outputTokens: 1_000,
          usedPercent: null,
          remainingPercent: null,
          freshness: "estimated",
          source: "message_usage",
          hasUsage: true,
        }}
      />,
    );

    await user.hover(container.querySelector('[data-slot="hover-card-trigger"]') as Element);

    expect(await screen.findByText("chat.claudeContextWindowEstimatedTokens")).toBeTruthy();
    expect(screen.queryByText("chat.claudeContextUnavailable")).toBeNull();
  });
});
