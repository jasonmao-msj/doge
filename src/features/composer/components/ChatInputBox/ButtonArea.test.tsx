// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ButtonArea } from "./ButtonArea";

// The tool dock is a Radix DropdownMenu; it opens on a pointer event
// sequence rather than a bare click. This helper drives it the way a real
// pointer would so the menu content (and the legacy inline tools mounted
// alongside it) renders synchronously enough for assertions.
function openToolDock() {
  // The DropdownMenu is modal, so once it opens Radix marks the trigger (and
  // every sibling) aria-hidden. `hidden: true` lets us re-find the trigger to
  // toggle it closed again.
  const toggle = screen.getByRole("button", {
    name: "Expand or collapse input tools",
    hidden: true,
  });
  fireEvent.pointerDown(toggle, { button: 0, ctrlKey: false });
  fireEvent.pointerUp(toggle, { button: 0 });
  return toggle;
}

// Opens the tool dock and then the memory reference submenu, returning its
// SubTrigger. The trigger is a Radix menuitem whose accessible name combines
// the label with the current-state text, so it is matched by regex.
function openMemoryReferenceMenu() {
  openToolDock();
  const trigger = screen.getByRole("menuitem", {
    name: /composer\.memoryReferenceToggle/,
  });
  // Radix opens a submenu on ArrowRight/Enter (not a bare click), so drive it
  // with the keyboard the way a real menu user would. The raw focus() and the
  // submenu open both trigger roving-focus state updates, so wrap them in act
  // to keep them from leaking as "not wrapped in act(...)" warnings.
  act(() => {
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
  });
  return trigger;
}

vi.mock("./selectors", () => ({
  ConfigSelect: () => <div data-testid="config-select" />,
  ModeSelect: () => <div data-testid="mode-select" />,
  ProviderSelect: () => <div data-testid="provider-select" />,
  ReasoningSelect: ({
    value,
    options,
    showDefaultOption,
    defaultLabel,
    onChange,
  }: {
    value: string | null;
    options?: string[];
    showDefaultOption?: boolean;
    defaultLabel?: string;
    onChange?: (value: string | null) => void;
  }) => (
    <div data-testid="reasoning-select">
      <span data-testid="reasoning-value">{value ?? ""}</span>
      <span data-testid="reasoning-options">{(options ?? []).join(",")}</span>
      <span data-testid="reasoning-default">{showDefaultOption ? defaultLabel : ""}</span>
      <button type="button" data-testid="reasoning-pick-high" onClick={() => onChange?.("high")}>
        high
      </button>
      <button type="button" data-testid="reasoning-pick-default" onClick={() => onChange?.(null)}>
        default
      </button>
    </div>
  ),
  ShortcutActionsSelect: () => <div data-testid="shortcut-actions-select" />,
}));

describe("ButtonArea custom model storage refresh", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders Claude reasoning selector with Claude default state", () => {
    render(
      <ButtonArea
        currentProvider="claude"
        models={[]}
        selectedModel=""
        reasoningEffort={null}
        reasoningOptions={["low", "medium", "high", "xhigh", "max"]}
        hasInputContent
        onSubmit={vi.fn()}
        onReasoningChange={vi.fn()}
        shortcutActions={[]}
      />,
    );

    openToolDock();

    expect(screen.getByTestId("reasoning-select")).toBeTruthy();
    expect(screen.getByTestId("reasoning-value").textContent).toBe("");
    expect(screen.getByTestId("reasoning-options").textContent).toBe("low,medium,high,xhigh,max");
    expect(screen.getByTestId("reasoning-default").textContent).toBe("Default");
  });

  it("renders Grok reasoning selector with default option and fixed allowlist", () => {
    render(
      <ButtonArea
        currentProvider="grok"
        models={[]}
        selectedModel=""
        reasoningEffort={null}
        reasoningOptions={["low", "medium", "high"]}
        hasInputContent
        onSubmit={vi.fn()}
        onReasoningChange={vi.fn()}
        shortcutActions={[]}
      />,
    );

    openToolDock();

    expect(screen.getByTestId("reasoning-select")).toBeTruthy();
    expect(screen.getByTestId("reasoning-value").textContent).toBe("");
    expect(screen.getByTestId("reasoning-options").textContent).toBe("low,medium,high");
    expect(screen.getByTestId("reasoning-default").textContent).toBe("Default");
  });

  it("does not render reasoning selector for Gemini", () => {
    render(
      <ButtonArea
        currentProvider="gemini"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        onReasoningChange={vi.fn()}
        shortcutActions={[]}
      />,
    );

    openToolDock();

    expect(screen.queryByTestId("reasoning-select")).toBeNull();
  });

  it("keeps the existing Codex reasoning selector without a default reset option", () => {
    render(
      <ButtonArea
        currentProvider="codex"
        models={[]}
        selectedModel=""
        reasoningEffort="high"
        reasoningOptions={["medium", "high"]}
        hasInputContent
        onSubmit={vi.fn()}
        onReasoningChange={vi.fn()}
        shortcutActions={[]}
      />,
    );

    openToolDock();

    expect(screen.getByTestId("reasoning-select")).toBeTruthy();
    expect(screen.getByTestId("reasoning-value").textContent).toBe("high");
    expect(screen.getByTestId("reasoning-options").textContent).toBe("medium,high");
    expect(screen.getByTestId("reasoning-default").textContent).toBe("");
  });

  it("keeps secondary tools collapsed until the tool dock is opened", () => {
    const { container } = render(
      <ButtonArea
        currentProvider="claude"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        onProviderSelect={vi.fn()}
        onReasoningChange={vi.fn()}
        shortcutActions={[]}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Expand or collapse input tools" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.querySelector(".selector-tool-icon")).toBeTruthy();
    expect(container.querySelector(".selector-tool-dock-toggle")?.textContent).not.toContain("工具");
    expect(screen.queryByTestId("config-select")).toBeNull();
    expect(screen.queryByTestId("provider-select")).toBeNull();
    expect(screen.queryByTestId("model-select")).toBeNull();
    // Reasoning select now lives permanently in the primary row (not the menu),
    // so it stays visible while the tool dock is collapsed.
    expect(screen.getByTestId("reasoning-select")).toBeTruthy();

    openToolDock();

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("config-select")).toBeTruthy();
    expect(screen.queryByTestId("provider-select")).toBeNull();
    expect(screen.getByTestId("reasoning-select")).toBeTruthy();
  });

  it("renders the status panel toggle inside the tool menu", () => {
    const onToggleStatusPanel = vi.fn();

    render(
      <ButtonArea
        currentProvider="claude"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        shortcutActions={[]}
        panelToggleSurface={(
          <button
            type="button"
            className="selector-button button-area-status-panel-toggle"
            onClick={onToggleStatusPanel}
            aria-label="Collapse status panel"
          >
            <span className="codicon codicon-layers" />
          </button>
        )}
      />,
    );

    // The panel toggle now lives inside the "+" tool menu alongside the other
    // relocated surfaces, so it is gated behind opening the dock.
    openToolDock();
    screen.getByRole("button", { name: "Collapse status panel" }).click();

    expect(onToggleStatusPanel).toHaveBeenCalledTimes(1);
  });

  it("opens prompt enhancement from the tool menu and closes the menu", () => {
    const onEnhancePrompt = vi.fn();

    render(
      <ButtonArea
        currentProvider="claude"
        hasInputContent
        onSubmit={vi.fn()}
        onEnhancePrompt={onEnhancePrompt}
      />,
    );

    const toggle = openToolDock();
    fireEvent.click(screen.getByRole("button", { name: "chat.shortcutActionEnhance" }));

    expect(onEnhancePrompt).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("disables the prompt enhancement entry while enhancement is running", () => {
    const onEnhancePrompt = vi.fn();

    render(
      <ButtonArea
        currentProvider="claude"
        hasInputContent
        isEnhancing
        onSubmit={vi.fn()}
        onEnhancePrompt={onEnhancePrompt}
      />,
    );

    openToolDock();
    const enhanceButton = screen.getByRole("button", {
      name: "chat.shortcutActionEnhance",
    }) as HTMLButtonElement;

    expect(enhanceButton.disabled).toBe(true);
    fireEvent.click(enhanceButton);
    expect(onEnhancePrompt).not.toHaveBeenCalled();
  });

  it("collapses the bottom tool buttons from the main toggle and Escape", () => {
    render(
      <ButtonArea
        currentProvider="claude"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        onProviderSelect={vi.fn()}
        onReasoningChange={vi.fn()}
        shortcutActions={[]}
      />,
    );

    const toggle = openToolDock();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("config-select")).toBeTruthy();

    openToolDock();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("config-select")).toBeNull();

    openToolDock();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps reasoning in the primary row while memory reference stays in the tool menu", () => {
    render(
      <ButtonArea
        currentProvider="claude"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        onReasoningChange={vi.fn()}
        shortcutActions={[]}
        memoryReferenceMode="off"
        onSetMemoryReferenceMode={vi.fn()}
      />,
    );

    // Reasoning stays visible without opening the "+" tool menu.
    expect(screen.getByTestId("reasoning-select")).toBeTruthy();

    openToolDock();

    // The memory reference control still lives inside the vertical tool menu.
    expect(
      screen.getByRole("menuitem", { name: /composer\.memoryReferenceToggle/ }),
    ).toBeTruthy();
  });

  it("selects single-send memory reference directly from the submenu", () => {
    const onSetMemoryReferenceMode = vi.fn();

    render(
      <ButtonArea
        currentProvider="codex"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        shortcutActions={[]}
        memoryReferenceMode="off"
        onSetMemoryReferenceMode={onSetMemoryReferenceMode}
      />,
    );

    openMemoryReferenceMenu();

    // The new submenu design has no confirmation dialog — picking an option is
    // itself the explicit action. The option labels render from their i18n
    // fallback text in the test environment.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "单次引用" }));

    expect(onSetMemoryReferenceMode).toHaveBeenCalledWith("single");
  });

  it("enables always-on memory reference from the submenu", () => {
    const onSetMemoryReferenceMode = vi.fn();

    render(
      <ButtonArea
        currentProvider="codex"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        shortcutActions={[]}
        memoryReferenceMode="off"
        onSetMemoryReferenceMode={onSetMemoryReferenceMode}
      />,
    );

    openMemoryReferenceMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "常开引用" }));

    expect(onSetMemoryReferenceMode).toHaveBeenCalledWith("always");
  });

  it("turns memory reference off from the submenu when already enabled", () => {
    const onSetMemoryReferenceMode = vi.fn();

    render(
      <ButtonArea
        currentProvider="codex"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        shortcutActions={[]}
        memoryReferenceMode="always"
        onSetMemoryReferenceMode={onSetMemoryReferenceMode}
      />,
    );

    // The SubTrigger reflects the current always-on state.
    const trigger = openMemoryReferenceMenu();
    expect(trigger.textContent).toContain("composer.memoryReferenceAlwaysOn");

    fireEvent.click(screen.getByRole("menuitem", { name: "关闭" }));

    expect(onSetMemoryReferenceMode).toHaveBeenCalledWith("off");
  });

  it("keeps the stop action clickable while advisory stream phase changes", () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <ButtonArea
        currentProvider="codex"
        models={[]}
        selectedModel=""
        disabled
        isLoading
        streamActivityPhase="waiting"
        hasInputContent={false}
        onStop={onStop}
        shortcutActions={[]}
      />,
    );

    const stopButton = screen.getByTitle("chat.stopGeneration") as HTMLButtonElement;
    expect(stopButton.disabled).toBe(false);
    expect(stopButton.dataset.streamPhase).toBe("waiting");

    rerender(
      <ButtonArea
        currentProvider="codex"
        models={[]}
        selectedModel=""
        disabled
        isLoading
        streamActivityPhase="ingress"
        hasInputContent={false}
        onStop={onStop}
        shortcutActions={[]}
      />,
    );

    fireEvent.click(screen.getByTitle("chat.stopGeneration"));

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("chat.stopGeneration").dataset.streamPhase).toBe(
      "ingress",
    );
  });

  it("places the Squad control immediately before the send action", () => {
    const { container } = render(
      <ButtonArea
        currentProvider="codex"
        hasInputContent
        onSubmit={vi.fn()}
        squadSurface={<button data-testid="squad-surface">Squad</button>}
      />,
    );

    const actionRow = container.querySelector(".button-area-right");
    expect(actionRow?.firstElementChild).toBe(
      screen.getByTestId("squad-surface"),
    );
    expect(actionRow?.lastElementChild).not.toBe(
      screen.getByTestId("squad-surface"),
    );
  });
});
