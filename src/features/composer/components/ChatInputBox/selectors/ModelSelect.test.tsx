// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildProviderExecutionTarget,
  isSameProviderExecutionProfile,
  ModelSelect,
  resolveActiveProviderProfileId,
  resolveAtomicSelectedModelDisplay,
  resolveClaudeCatalogModelLabel,
  resolveModelIdForIcon,
} from "./ModelSelect";
import { STORAGE_KEYS } from "../../../types/provider";
import type { ExecutionTarget } from "../../../../shared-session/target/types";
import type { ProviderTargetGroup } from "../hooks/useProviderTargetCatalogOwners";
import {
  clearManagedEngineEntitlementsV1,
  publishManagedEngineEntitlementsV1,
} from "../../../../account/runtime/engineEntitlementStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.model
        ? `${key}:${params.model}`
        : params?.message
          ? `${key}:${params.message}`
          : key,
  }),
}));

vi.mock("../../../../engine/components/EngineIcon", () => ({
  EngineIcon: ({ engine }: { engine: string }) => (
    <span data-testid={`${engine}-icon`} />
  ),
}));

vi.mock("../../../../vendors/providerBrandIcon", () => ({
  providerBrandIconThemeStrategy: () => "original",
  PROVIDER_BRAND_ICON_SRC: {
    claude: "/icons/claude.svg",
    openai: "/icons/openai.svg",
    kimi: "/icons/kimi.svg",
    opencode: "/icons/opencode.svg",
  },
  resolveProviderBrandIcon: ({ modelId }: { modelId?: string | null }) => {
    if (modelId === "kimi-k3" || modelId?.includes("kimi")) {
      return "/icons/kimi.svg";
    }
    if (modelId?.startsWith("gpt-") || modelId?.includes("openai")) {
      return "/icons/openai.svg";
    }
    if (modelId?.includes("claude")) {
      return "/icons/claude.svg";
    }
    return null;
  },
}));

describe("ModelSelect", () => {
  afterEach(() => {
    window.localStorage.clear();
    act(() => clearManagedEngineEntitlementsV1());
  });

  it("renders the readiness trigger with provider and selected model chrome", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();

    render(
      <ModelSelect
        value="demo"
        currentProvider="codex"
        providerLabel="Codex"
        triggerVariant="readiness"
        onChange={onChange}
        models={[{ id: "demo", label: "demo" }]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "chat.currentModel:demo" });

    expect(trigger.className).toContain("composer-readiness-target-button");
    // Provider is shown as an engine icon, the selected model as text.
    expect(within(trigger).getByTestId("codex-icon")).toBeTruthy();
    expect(trigger.textContent).toContain("demo");

    await user.click(trigger);
    const option = await screen.findByRole("menuitem", { name: /demo/ });
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith("demo");
  });

  it("renders grouped providers first and opens provider models on hover", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onChange = vi.fn();
    const onProviderModelChange = vi.fn();

    render(
      <ModelSelect
        value="gpt-5.4"
        currentProvider="codex"
        providerLabel="Codex"
        triggerVariant="readiness"
        onChange={onChange}
        onProviderModelChange={onProviderModelChange}
        models={[{ id: "gpt-5.4", label: "GPT-5.4" }]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [{ id: "claude-sonnet-4-6", label: "Sonnet 4.6", description: "hidden" }],
          },
          {
            providerId: "codex",
            providerLabel: "Codex",
            enabled: true,
            models: [{ id: "gpt-5.4", label: "GPT-5.4", description: "hidden" }],
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:GPT-5.4" }),
    );

    // The first level is provider/CLI only; models stay in the hover submenu.
    const claudeProviderItem = await screen.findByRole("menuitem", { name: /Claude Code/ });
    expect(screen.getByRole("menuitem", { name: /Codex/ })).toBeTruthy();
    // Trigger still shows the selected model text; model rows are not yet in the menu.
    expect(screen.queryByRole("menuitem", { name: /Sonnet 4\.6/ })).toBeNull();

    await user.hover(claudeProviderItem);
    const sonnetItem = await screen.findByRole("menuitem", {
      name: /Sonnet 4\.6|models\.claude\.sonnet46/,
    });
    expect(sonnetItem).toBeTruthy();
    // Grouped items now show the tier description subtitle (jetbrains parity).
    expect(sonnetItem.textContent).toMatch(
      /models\.claude\.sonnet46\.description|hidden/,
    );

    fireEvent.click(sonnetItem);

    expect(onProviderModelChange).toHaveBeenCalledWith("claude", "claude-sonnet-4-6");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks an unsubscribed managed engine in the main picker", async () => {
    publishManagedEngineEntitlementsV1([
      { id: "codex", displayName: "Codex", entitlement: { status: "active", expiresAt: null } },
      { id: "claude-code", displayName: "Claude", entitlement: { status: "none", expiresAt: null } },
    ]);
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <ModelSelect
        value="gpt-5.4"
        currentProvider="codex"
        onChange={vi.fn()}
        models={[{ id: "gpt-5.4", label: "GPT-5.4" }]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude",
            enabled: true,
            models: [{ id: "claude-sonnet", label: "Sonnet" }],
          },
          {
            providerId: "codex",
            providerLabel: "Codex",
            enabled: true,
            models: [{ id: "gpt-5.4", label: "GPT-5.4" }],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "chat.currentModel:GPT-5.4" }));

    expect(screen.getByRole("menuitem", { name: /Claude.*models\.subscribeToUse/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Codex/ }).textContent).not.toContain("models.subscribeToUse");
  });

  it("uses runtime model ids for mapped model brand icons", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({ opus: "kimi-k3" }),
    );

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[
          {
            id: "claude-opus-4-8",
            model: "kimi-k3",
            label: "Opus 4.8",
          },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [
              {
                id: "claude-opus-4-8",
                model: "kimi-k3",
                label: "Opus 4.8",
              },
            ],
          },
        ]}
      />,
    );

    // Mapped label becomes kimi-k3 (not the original Opus 4.8 tier name).
    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:kimi-k3",
    });
    expect(trigger.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
    expect(within(trigger).queryByTestId("claude-icon")).toBeNull();

    await user.click(trigger);
    const claudeProviderItem = await screen.findByRole("menuitem", {
      name: /Claude Code/,
    });
    expect(within(claudeProviderItem).getByTestId("claude-icon")).toBeTruthy();

    await user.hover(claudeProviderItem);
    const opusItem = await screen.findByRole("menuitem", { name: /kimi-k3/ });
    expect(opusItem.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
    // Subtitle explains the tier while the primary label shows the mapped model.
    expect(opusItem.textContent).toMatch(/Opus 4\.8|models\.claude\.opus48/);
  });

  it("uses the Kimi brand tile for provider row, model rows, and trigger", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="k3"
        currentProvider="kimi"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[{ id: "k3", label: "K3" }]}
        modelGroups={[
          {
            providerId: "kimi",
            providerLabel: "Kimi CLI",
            enabled: true,
            models: [
              { id: "k3", label: "K3" },
              { id: "k3-256k", label: "K3-256k" },
            ],
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:K3",
    });
    expect(trigger.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
    expect(within(trigger).queryByTestId("kimi-icon")).toBeNull();

    await user.click(trigger);
    const kimiProviderItem = await screen.findByRole("menuitem", {
      name: /Kimi CLI/,
    });
    expect(kimiProviderItem.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
    expect(within(kimiProviderItem).queryByTestId("kimi-icon")).toBeNull();

    await user.hover(kimiProviderItem);
    const k3Item = await screen.findByRole("menuitem", { name: /^K3$/ });
    const k3256Item = await screen.findByRole("menuitem", { name: /K3-256k/ });
    expect(k3Item.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
    expect(k3256Item.querySelector("img")?.getAttribute("src")).toBe(
      "/icons/kimi.svg",
    );
  });

  it("uses the Codex EngineIcon for provider row, native gpt models, and trigger", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="gpt-5.6-sol"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[{ id: "gpt-5.6-sol", label: "gpt-5.6-sol" }]}
        modelGroups={[
          {
            providerId: "codex",
            providerLabel: "Codex CLI",
            enabled: true,
            models: [
              { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
              { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
            ],
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:gpt-5.6-sol",
    });
    // Native Codex models must not flip to the lobehub openai brand SVG —
    // the provider glyph (EngineIcon) is the single source of truth.
    expect(within(trigger).getByTestId("codex-icon")).toBeTruthy();
    expect(trigger.querySelector("img")).toBeNull();

    await user.click(trigger);
    const codexProviderItem = await screen.findByRole("menuitem", {
      name: /Codex CLI/,
    });
    expect(within(codexProviderItem).getByTestId("codex-icon")).toBeTruthy();
    expect(codexProviderItem.querySelector("img")).toBeNull();

    await user.hover(codexProviderItem);
    const solItem = await screen.findByRole("menuitem", {
      name: /gpt-5\.6-sol/,
    });
    const terraItem = await screen.findByRole("menuitem", {
      name: /gpt-5\.6-terra/,
    });
    expect(within(solItem).getByTestId("codex-icon")).toBeTruthy();
    expect(solItem.querySelector("img")).toBeNull();
    expect(within(terraItem).getByTestId("codex-icon")).toBeTruthy();
    expect(terraItem.querySelector("img")).toBeNull();
  });

  it("uses the Grok EngineIcon for provider row, model rows, and trigger", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="grok-4.5"
        currentProvider="grok"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[{ id: "grok-4.5", label: "Grok 4.5" }]}
        modelGroups={[
          {
            providerId: "grok",
            providerLabel: "Grok CLI",
            enabled: true,
            models: [{ id: "grok-4.5", label: "Grok 4.5" }],
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:Grok 4.5",
    });
    expect(within(trigger).getByTestId("grok-icon")).toBeTruthy();
    expect(trigger.querySelector("img")).toBeNull();

    await user.click(trigger);
    const grokProviderItem = await screen.findByRole("menuitem", {
      name: /Grok CLI/,
    });
    expect(within(grokProviderItem).getByTestId("grok-icon")).toBeTruthy();

    await user.hover(grokProviderItem);
    const modelItem = await screen.findByRole("menuitem", { name: /Grok 4\.5/ });
    expect(within(modelItem).getByTestId("grok-icon")).toBeTruthy();
    expect(modelItem.querySelector("img")).toBeNull();
  });

  it("shows mapped labels and tier descriptions for every Claude family slot", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({
        fable: "kimi-k3",
        opus: "kimi-k3",
        sonnet: "kimi-k3",
        haiku: "kimi-k3",
      }),
    );

    render(
      <ModelSelect
        value="claude-fable-5"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[
          { id: "claude-fable-5", model: "kimi-k3", label: "Fable 5" },
          { id: "claude-opus-4-8", model: "kimi-k3", label: "Opus 4.8" },
          { id: "claude-sonnet-5", model: "kimi-k3", label: "Sonnet 5" },
          {
            id: "claude-haiku-4-5-20251001",
            model: "kimi-k3",
            label: "Haiku 4.5",
          },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [
              { id: "claude-fable-5", model: "kimi-k3", label: "Fable 5" },
              { id: "claude-opus-4-8", model: "kimi-k3", label: "Opus 4.8" },
              { id: "claude-sonnet-5", model: "kimi-k3", label: "Sonnet 5" },
              {
                id: "claude-haiku-4-5-20251001",
                model: "kimi-k3",
                label: "Haiku 4.5",
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "chat.currentModel:kimi-k3" }),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:kimi-k3" }),
    );
    await user.hover(
      await screen.findByRole("menuitem", { name: /Claude Code/ }),
    );

    const fableItem = await screen.findByRole("menuitem", {
      name: /kimi-k3[\s\S]*models\.claude\.fable5\.description|kimi-k3[\s\S]*Fable 5/,
    });
    const opusItem = await screen.findByRole("menuitem", {
      name: /kimi-k3[\s\S]*models\.claude\.opus48\.description|kimi-k3[\s\S]*Opus 4\.8/,
    });
    const sonnetItem = await screen.findByRole("menuitem", {
      name: /kimi-k3[\s\S]*models\.claude\.sonnet5\.description|kimi-k3[\s\S]*Sonnet 5/,
    });
    const haikuItem = await screen.findByRole("menuitem", {
      name: /kimi-k3[\s\S]*models\.claude\.haiku45\.description|kimi-k3[\s\S]*Haiku/,
    });

    for (const item of [fableItem, opusItem, sonnetItem, haikuItem]) {
      expect(item.textContent).toContain("kimi-k3");
      expect(item.querySelector("img")?.getAttribute("src")).toBe(
        "/icons/kimi.svg",
      );
    }
  });

  it("does not display the first model when no model value is selected", () => {
    render(
      <ModelSelect
        value=""
        currentProvider="codex"
        onChange={vi.fn()}
        models={[
          {
            id: "gpt-5.5",
            label: "gpt-5.5",
          },
        ]}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";

    expect(buttonText).toContain("models.selectModel");
    expect(buttonText).not.toContain("gpt-5.5");
  });

  it("renders independent add model and refresh config footer actions", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddModel = vi.fn();
    const onRefreshConfig = vi.fn();

    render(
      <ModelSelect
        value="gpt-5.5"
        currentProvider="codex"
        onChange={vi.fn()}
        onAddModel={onAddModel}
        onRefreshConfig={onRefreshConfig}
        models={[{ id: "gpt-5.5", label: "gpt-5.5" }]}
      />,
    );

    await user.click(screen.getAllByRole("button")[0]);
    await user.click(await screen.findByRole("menuitem", { name: "models.refreshConfig" }));

    expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    expect(onAddModel).not.toHaveBeenCalled();

    // Refresh keeps the menu open; the add action is still reachable.
    await user.click(screen.getByRole("menuitem", { name: "models.addModel" }));

    expect(onAddModel).toHaveBeenCalledTimes(1);
    expect(onAddModel).toHaveBeenCalledWith("codex");
    expect(onRefreshConfig).toHaveBeenCalledTimes(1);
  });

  it("moves config actions into the current provider submenu when providers are grouped", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddModel = vi.fn();
    const onRefreshConfig = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={onAddModel}
        onRefreshConfig={onRefreshConfig}
        models={[
          { id: "claude-opus-4-8", label: "Opus 4.8" },
          { id: "claude-sonnet-5", label: "Sonnet 5" },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [
              { id: "claude-opus-4-8", label: "Opus 4.8" },
              { id: "claude-sonnet-5", label: "Sonnet 5" },
            ],
          },
          {
            providerId: "codex",
            providerLabel: "Codex",
            enabled: true,
            models: [{ id: "gpt-5.4", label: "GPT-5.4" }],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }));
    await user.hover(await screen.findByRole("menuitem", { name: /Claude Code/ }));

    expect(screen.queryByRole("menuitem", { name: "models.refreshConfig" })).toBeNull();

    const refreshButton = await screen.findByRole("button", { name: "models.refreshConfig" });
    expect(refreshButton.textContent).toBe("");

    const opusItem = await screen.findByRole("menuitem", { name: /Opus 4.8/ });
    const sonnetItem = screen.getByRole("menuitem", { name: /Sonnet 5/ });
    const addItem = screen.getByRole("menuitem", { name: "models.addModel" });
    const submenuContent = opusItem.closest("[data-slot='dropdown-menu-sub-content']");

    expect(submenuContent).toBeTruthy();
    const items = Array.from(
      submenuContent!.querySelectorAll("[role='menuitem']"),
    );
    expect(items.indexOf(addItem)).toBeGreaterThan(items.indexOf(opusItem));
    expect(items.indexOf(addItem)).toBeGreaterThan(items.indexOf(sonnetItem));

    fireEvent.click(addItem);
    expect(onAddModel).toHaveBeenCalledTimes(1);
    expect(onAddModel).toHaveBeenCalledWith("claude");

    await user.click(screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }));
    await user.hover(await screen.findByRole("menuitem", { name: /Claude Code/ }));
    fireEvent.click(await screen.findByRole("button", { name: "models.refreshConfig" }));

    expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    expect(onAddModel).toHaveBeenCalledTimes(1);
  });

  it("shows add model in every provider submenu, not only the current engine", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddModel = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={onAddModel}
        models={[
          { id: "claude-opus-4-8", label: "Opus 4.8" },
          { id: "gpt-5.4", label: "GPT-5.4" },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [{ id: "claude-opus-4-8", label: "Opus 4.8" }],
          },
          {
            providerId: "codex",
            providerLabel: "Codex",
            enabled: true,
            models: [{ id: "gpt-5.4", label: "GPT-5.4" }],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }));
    await user.hover(await screen.findByRole("menuitem", { name: /Codex/ }));

    const addItem = await screen.findByRole("menuitem", { name: "models.addModel" });
    fireEvent.click(addItem);

    expect(onAddModel).toHaveBeenCalledTimes(1);
    expect(onAddModel).toHaveBeenCalledWith("codex");
  });

  it("hides the legacy CLI settings footer from the product model menu", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onOpenCliSettings = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onOpenCliSettings={onOpenCliSettings}
        models={[
          { id: "claude-opus-4-8", label: "Opus 4.8" },
          { id: "claude-sonnet-5", label: "Sonnet 5" },
        ]}
        modelGroups={[
          {
            providerId: "claude",
            providerLabel: "Claude Code",
            enabled: true,
            models: [
              { id: "claude-opus-4-8", label: "Opus 4.8" },
              { id: "claude-sonnet-5", label: "Sonnet 5" },
            ],
          },
          {
            providerId: "codex",
            providerLabel: "Codex CLI",
            enabled: true,
            models: [{ id: "gpt-5.4", label: "GPT-5.4" }],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }));

    expect(
      screen.queryByRole("menuitem", { name: "models.openCliSettings" }),
    ).toBeNull();
    expect(onOpenCliSettings).not.toHaveBeenCalled();
  });

  it("prefers active localStorage mapping over parent-provided tier labels", () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({ sonnet: "kimi-k3" }),
    );

    render(
      <ModelSelect
        value="claude-sonnet-4-6"
        currentProvider="claude"
        onChange={vi.fn()}
        models={[{ id: "claude-sonnet-4-6", label: "Sonnet 4.6" }]}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";

    expect(buttonText).toContain("kimi-k3");
    expect(buttonText).not.toContain("Sonnet 4.6");
  });

  it("does not rewrite non-Claude engine labels with Claude main mapping", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    window.localStorage.setItem(
      STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({ main: "deepseek-v4-pro" }),
    );

    render(
      <ModelSelect
        value="gpt-5.6-sol"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[
          { id: "gpt-5.6-sol", label: "gpt-5.6-sol" },
          { id: "gpt-5.6-terra", label: "gpt-5.6-terra" },
          { id: "gpt-5.6-luna", label: "gpt-5.6-luna" },
          { id: "gpt-5.5", label: "gpt-5.5" },
        ]}
        modelGroups={[
          {
            providerId: "codex",
            providerLabel: "Codex CLI",
            enabled: true,
            models: [
              {
                id: "gpt-5.6-sol",
                label: "gpt-5.6-sol",
                description: "Latest frontier agentic coding model.",
              },
              {
                id: "gpt-5.6-terra",
                label: "gpt-5.6-terra",
                description: "Balanced agentic coding model for everyday work.",
              },
              {
                id: "gpt-5.6-luna",
                label: "gpt-5.6-luna",
                description: "Fast and affordable agentic coding model.",
              },
              {
                id: "gpt-5.5",
                label: "gpt-5.5",
                description:
                  "Frontier model for complex coding, research, and real-world work.",
              },
            ],
          },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "chat.currentModel:gpt-5.6-sol",
    });
    expect(trigger.textContent).not.toContain("deepseek-v4-pro");

    await user.click(trigger);
    await user.hover(
      await screen.findByRole("menuitem", { name: /Codex CLI/ }),
    );

    for (const modelId of [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
    ]) {
      const item = await screen.findByRole("menuitem", {
        name: new RegExp(modelId),
      });
      expect(item.textContent).toContain(modelId);
      expect(item.textContent).not.toContain("deepseek-v4-pro");
    }
  });

  it("does not synthesize a missing Claude selected value as a fallback option", () => {
    render(
      <ModelSelect
        value="sonnet"
        currentProvider="claude"
        onChange={vi.fn()}
        models={[]}
      />,
    );

    expect(screen.queryByText("sonnet")).toBeNull();
    expect(screen.getByRole("button").textContent ?? "").toContain("models.selectModel");
  });

  it("resolveAtomicSelectedModelDisplay uses executionTarget snapshot when catalog is empty", () => {
    const target: ExecutionTarget = {
      engine: "grok",
      providerProfileId: null,
      modelCatalogEntryId: "grok",
      model: "grok",
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
    };

    const display = resolveAtomicSelectedModelDisplay(target, "grok", []);
    expect(display?.id).toBe("grok");
    expect(display?.model).toBe("grok");
  });

  it("resolveAtomicSelectedModelDisplay supports native-like target with catalog entry only", () => {
    // Native nativeSessionTarget 常见：catalog 未命中时 model runtime 仍可能为空，
    // 但 modelCatalogEntryId 已由 selectedModelId / nativeAtomicSelection 写入。
    const nativeLike: ExecutionTarget = {
      engine: "codex",
      providerProfileId: null,
      modelCatalogEntryId: "gpt-5.5",
      model: null,
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
    };
    const display = resolveAtomicSelectedModelDisplay(
      nativeLike,
      "gpt-5.5",
      [],
    );
    expect(display?.id).toBe("gpt-5.5");
    expect(display?.label).toBe("gpt-5.5");
  });

  it("resolveAtomicSelectedModelDisplay prefers catalog row when loaded", () => {
    const target: ExecutionTarget = {
      engine: "claude",
      providerProfileId: "kimi-k3",
      modelCatalogEntryId: "claude-sonnet-4-6",
      model: "kimi-k2.5",
      reasoning: null,
      providerProfileNameSnapshot: "kimi-k3",
      providerProfileSource: "managed",
    };
    const display = resolveAtomicSelectedModelDisplay(target, "claude-sonnet-4-6", [
      {
        id: "claude-sonnet-4-6",
        model: "kimi-k2.5",
        label: "Kimi friendly",
        providerProfileId: "kimi-k3",
      },
    ]);
    expect(display?.label).toBe("Kimi friendly");
    expect(display?.model).toBe("kimi-k2.5");
  });

  it("resolveAtomicSelectedModelDisplay returns null without model identity", () => {
    expect(
      resolveAtomicSelectedModelDisplay(
        {
          engine: "grok",
          providerProfileId: null,
          modelCatalogEntryId: null,
          model: null,
          reasoning: null,
          providerProfileNameSnapshot: "本地配置",
          providerProfileSource: "disk",
        },
        "",
        [],
      ),
    ).toBeNull();
  });

  it("shows shared grok executionTarget on closed trigger when catalog and parent models miss", () => {
    const executionTarget: ExecutionTarget = {
      engine: "grok",
      providerProfileId: null,
      modelCatalogEntryId: "grok",
      model: "grok",
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
    };
    const targetGroups: ProviderTargetGroup[] = [
      {
        providerId: "grok",
        providerLabel: "Grok CLI",
        enabled: true,
        profiles: [
          {
            id: "__local_config_toml__",
            label: "本地配置",
            source: "disk",
            enabled: true,
            models: [],
            loading: true,
            reloadingConfig: false,
            discoveringModels: false,
            discoverySupported: false,
            error: null,
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value="grok"
        currentProvider="claude"
        onChange={vi.fn()}
        models={[
          { id: "claude-sonnet-4-6", label: "Sonnet" },
          { id: "claude-opus-4-6", label: "Opus" },
        ]}
        targetGroups={targetGroups}
        executionTarget={executionTarget}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";
    expect(buttonText).toContain("grok");
    expect(buttonText).not.toContain("models.selectModel");
    expect(buttonText).not.toContain("Sonnet");
  });

  it("keeps unselected closed trigger when atomic mode has no executionTarget model", () => {
    const targetGroups: ProviderTargetGroup[] = [
      {
        providerId: "grok",
        providerLabel: "Grok CLI",
        enabled: true,
        profiles: [
          {
            id: "__local_config_toml__",
            label: "本地配置",
            source: "disk",
            enabled: true,
            models: [],
            loading: false,
            reloadingConfig: false,
            discoveringModels: false,
            discoverySupported: false,
            error: null,
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value=""
        currentProvider="grok"
        onChange={vi.fn()}
        models={[{ id: "global-other", label: "Other" }]}
        targetGroups={targetGroups}
        executionTarget={null}
      />,
    );

    expect(screen.getByRole("button").textContent ?? "").toContain(
      "models.selectModel",
    );
  });

  it("shows native codex selection from executionTarget when atomic catalog is still empty", () => {
    const executionTarget: ExecutionTarget = {
      engine: "codex",
      providerProfileId: null,
      modelCatalogEntryId: "gpt-5.5",
      model: null,
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
    };
    const targetGroups: ProviderTargetGroup[] = [
      {
        providerId: "codex",
        providerLabel: "Codex CLI",
        enabled: true,
        profiles: [
          {
            id: "__disk__",
            label: "本地配置",
            source: "disk",
            enabled: true,
            models: [],
            loading: true,
            reloadingConfig: false,
            discoveringModels: false,
            discoverySupported: true,
            error: null,
          },
        ],
      },
    ];

    render(
      <ModelSelect
        value="gpt-5.5"
        currentProvider="codex"
        onChange={vi.fn()}
        models={[]}
        targetGroups={targetGroups}
        executionTarget={executionTarget}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";
    expect(buttonText).toContain("gpt-5.5");
    expect(buttonText).not.toContain("models.selectModel");
  });

  it("renders settings-sourced Claude runtime models without legacy family relabeling", () => {
    render(
      <ModelSelect
        value="settings-opus"
        currentProvider="claude"
        onChange={vi.fn()}
        models={[
          {
            id: "settings-opus",
            label: "MiniMax-M4[1m]",
            description: "Custom Opus model configured by ANTHROPIC_DEFAULT_OPUS_MODEL",
          },
        ]}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";

    expect(buttonText).toContain("MiniMax-M4[1m]");
    expect(buttonText).not.toContain("Opus 4.6");
  });

  it("disables refresh config action while refreshing", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <ModelSelect
        value="claude-sonnet-4-6"
        currentProvider="claude"
        onChange={vi.fn()}
        onAddModel={vi.fn()}
        onRefreshConfig={vi.fn()}
        isRefreshingConfig
        models={[{ id: "claude-sonnet-4-6", label: "Sonnet" }]}
      />,
    );

    await user.click(screen.getAllByRole("button")[0]);

    const refreshItem = await screen.findByRole("menuitem", {
      name: "models.refreshingConfig",
    });
    expect(refreshItem.getAttribute("data-disabled")).not.toBeNull();
  });

  it("keeps the dropdown usable when refresh config fails", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <ModelSelect
        value="gemini-2.5-flash"
        currentProvider="gemini"
        onChange={vi.fn()}
        onAddModel={vi.fn()}
        onRefreshConfig={vi.fn().mockRejectedValue(new Error("settings.json invalid"))}
        models={[{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }]}
      />,
    );

    await user.click(screen.getAllByRole("button")[0]);
    await user.click(await screen.findByRole("menuitem", { name: "models.refreshConfig" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("settings.json invalid");
    });

    expect(screen.getAllByText("Gemini 2.5 Flash").length).toBeGreaterThan(0);
  });
});

const atomicExecutionTarget: ExecutionTarget = {
  engine: "claude",
  providerProfileId: null,
  modelCatalogEntryId: "claude-opus-4-8",
  model: "claude-opus-4-8",
  providerProfileNameSnapshot: "本地配置",
  providerProfileSource: "disk",
};

function buildAtomicGroups(): ProviderTargetGroup[] {
  return [
    {
      providerId: "claude" as const,
      providerLabel: "Claude Code",
      enabled: true,
      profiles: [
        {
          id: "__local_settings_json__",
          label: "本地配置",
          source: "disk" as const,
          loading: false,
          error: null,
          models: [
            { id: "claude-opus-4-8", label: "Opus 4.8" },
            { id: "claude-sonnet-5", label: "Sonnet 5" },
          ],
        },
        {
          id: "k3",
          label: "k3",
          source: "managed" as const,
          loading: false,
          error: null,
          models: [{ id: "kimi-k3", label: "Kimi K3" }],
        },
      ],
    },
    {
      providerId: "codex" as const,
      providerLabel: "Codex CLI",
      enabled: true,
      profiles: [
        {
          id: "__disk__",
          label: "Local disk",
          source: "disk" as const,
          loading: false,
          error: null,
          models: [{ id: "gpt-5.7", label: "GPT-5.7" }],
        },
      ],
    },
  ];
}

describe("ModelSelect atomic target groups", () => {
  afterEach(() => {
    act(() => clearManagedEngineEntitlementsV1());
  });

  // Radix 子菜单在 jsdom 下的 hover 开启依赖真实定时器,容易抖动;
  // 直接 click SubTrigger 是确定性的打开方式。
  // 注意:jsdom 下 Radix modal layer 会给「后打开」的子菜单留下
  // aria-hidden 残留,第二个子菜单的断言用 byText/DOM 查询而非 byRole。
  function openPickerSubmenu(name: RegExp) {
    const trigger = screen.getByRole("menuitem", { name });
    fireEvent.click(trigger);
    return trigger;
  }

  it("defaults every actively subscribed Home engine submenu to Doge", async () => {
    act(() => {
      publishManagedEngineEntitlementsV1([
        { id: "codex", displayName: "Codex", entitlement: { status: "active", expiresAt: null } },
        { id: "claude-code", displayName: "Claude", entitlement: { status: "active", expiresAt: null } },
      ]);
    });
    const groups = buildAtomicGroups();
    groups[0].profiles.push({
      id: "doge-token-matrix",
      label: "Doge",
      source: "managed",
      loading: false,
      error: null,
      models: [{
        id: "claude-fable-5",
        label: "Fable 5",
        providerProfileId: "doge-token-matrix",
      }],
    });
    groups[1].profiles.push({
      id: "doge-token-matrix",
      label: "Doge",
      source: "managed",
      loading: false,
      error: null,
      models: [{
        id: "gpt-5.6-sol",
        label: "gpt-5.6-sol",
        providerProfileId: "doge-token-matrix",
      }],
    });
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="gpt-5.6-sol"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={{
          engine: "codex",
          providerProfileId: "doge-token-matrix",
          modelCatalogEntryId: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          providerProfileNameSnapshot: "Doge",
          providerProfileSource: "managed",
        }}
        targetGroups={groups}
        preferManagedProviderDefaults
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:gpt-5.6-sol" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);

    expect(await screen.findByRole("menuitem", { name: /Fable 5/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Opus 4.8/ })).toBeNull();
    const claudeChannel = document.querySelector(
      "[data-submenu-footer='claude'] [data-channel-select-trigger='claude'][data-provider-profile-id='doge-token-matrix']",
    );
    expect(claudeChannel?.textContent).toContain("Doge");

  });

  it("opens the active channel models with footer channel switcher and no profile list rows", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );

    await screen.findByRole("menuitem", { name: /Claude Code/ });
    expect(screen.getByRole("menuitem", { name: /Codex CLI/ })).toBeTruthy();
    // Channel options stay out of the model list until the dialog opens.
    expect(screen.queryByText("k3")).toBeNull();

    openPickerSubmenu(/Claude Code/);
    expect(await screen.findByRole("menuitem", { name: /Opus 4.8/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Sonnet 5/ })).toBeTruthy();
    // The inactive channel's models stay hidden.
    expect(screen.queryByText("Kimi K3")).toBeNull();
    // Footer exposes equal-width channel / add-model buttons.
    const claudeChannel = document.querySelector(
      "[data-submenu-footer='claude'] [data-channel-select-trigger='claude'][data-provider-profile-id='__local_settings_json__']",
    );
    expect(claudeChannel).toBeTruthy();
    expect(claudeChannel?.textContent).toContain("本地配置");

    openPickerSubmenu(/Codex CLI/);
    expect(await screen.findByText("GPT-5.7")).toBeTruthy();
    const codexChannel = document.querySelector(
      "[data-submenu-footer='codex'] [data-channel-select-trigger='codex'][data-provider-profile-id='__disk__']",
    );
    expect(codexChannel).toBeTruthy();
  });

  it("places equal channel and add-model buttons on the same footer row", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddModel = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={onAddModel}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);

    const footer = document.querySelector(
      "[data-submenu-footer='claude']",
    ) as HTMLElement;
    expect(footer).toBeTruthy();
    const channelButton = footer.querySelector(
      "[data-channel-select-trigger='claude']",
    ) as HTMLButtonElement;
    const addButton = within(footer).getByRole("button", {
      name: "models.addModel",
    });
    expect(channelButton).toBeTruthy();
    expect(channelButton.className).toContain("flex-1");
    expect(addButton.className).toContain("flex-1");

    const opusItem = screen.getByRole("menuitem", { name: /Opus 4.8/ });
    // Footer sits after model rows.
    expect(
      opusItem.compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(addButton);
    expect(onAddModel).toHaveBeenCalledWith("claude");
  });

  it("emits a complete execution target when picking a model", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Sonnet 5/ }));

    expect(onExecutionTargetChange).toHaveBeenCalledWith({
      engine: "claude",
      providerProfileId: null,
      modelCatalogEntryId: "claude-sonnet-5",
      model: "claude-sonnet-5",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
      reasoning: null,
    });
  });

  it("projects the target channel for the current engine and the local default elsewhere", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onOpenProviderProfile = vi.fn();

    render(
      <ModelSelect
        value="kimi-k3"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        onOpenTargetCatalog={vi.fn()}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={{
          ...atomicExecutionTarget,
          providerProfileId: "k3",
          modelCatalogEntryId: "kimi-k3",
          model: "kimi-k3",
        }}
        targetGroups={buildAtomicGroups()}
      />,
    );

    // Trigger resolves the label from the target channel's catalog.
    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Kimi K3" }),
    );

    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);
    expect(await screen.findByRole("menuitem", { name: /Kimi K3/ })).toBeTruthy();
    expect(screen.queryByText("Opus 4.8")).toBeNull();

    // Menu open prefetches the target channel for Claude and the local default for Codex.
    expect(onOpenProviderProfile).toHaveBeenCalledWith("claude", "k3");
    expect(onOpenProviderProfile).toHaveBeenCalledWith("codex", "__disk__");
  });

  it("marks the target engine and model selected", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );

    const claudeTrigger = await screen.findByRole("menuitem", { name: /Claude Code/ });
    expect(claudeTrigger.getAttribute("data-selected")).toBe("true");
    expect(
      screen.getByRole("menuitem", { name: /Codex CLI/ }).getAttribute("data-selected"),
    ).toBeNull();

    openPickerSubmenu(/Claude Code/);
    const opusItem = await screen.findByRole("menuitem", { name: /Opus 4.8/ });
    expect(opusItem.getAttribute("data-selected")).toBe("true");
    expect(
      screen.getByRole("menuitem", { name: /Sonnet 5/ }).getAttribute("data-selected"),
    ).toBeNull();
  });

  it("shows loading and error rows for the active channel", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const groups = buildAtomicGroups();
    groups[0].profiles[0].loading = true;
    groups[1].profiles[0].error = "disk unreadable";

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );

    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);
    expect(
      await screen.findByRole("menuitem", { name: /models.refreshingConfig/ }),
    ).toBeTruthy();
    // Last-good models stay interactive while refreshing.
    expect(screen.getByRole("menuitem", { name: /Opus 4.8/ })).toBeTruthy();

    openPickerSubmenu(/Codex CLI/);
    expect((await screen.findByText("disk unreadable")).className).toContain(
      "text-destructive",
    );
  });

  it("reloads each CLI active channel from the submenu header", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onReloadProviderConfig = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        onReloadProviderConfig={onReloadProviderConfig}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );

    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);
    fireEvent.click(
      await screen.findByRole("button", { name: "models.refreshConfig" }),
    );
    expect(onReloadProviderConfig).toHaveBeenCalledWith(
      "claude",
      "__local_settings_json__",
    );

    openPickerSubmenu(/Codex CLI/);
    const gptItem = await screen.findByText("GPT-5.7");
    const codexSubContent = gptItem.closest(
      "[data-slot='dropdown-menu-sub-content']",
    );
    expect(codexSubContent).toBeTruthy();
    const codexRefresh = codexSubContent!.querySelector(
      "button[aria-label='models.refreshConfig']",
    );
    expect(codexRefresh).toBeTruthy();
    fireEvent.click(codexRefresh!);
    expect(onReloadProviderConfig).toHaveBeenCalledWith("codex", "__disk__");
  });

  it("switches the current engine channel immediately via the channel dialog", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    // Shared 路径：ensureModels 返回目标渠道 catalog，切换后必须用新模型而非旧渠道 id
    const onOpenProviderProfile = vi.fn().mockResolvedValue([
      { id: "kimi-k3", model: "kimi-k3", label: "Kimi K3", providerProfileId: "k3" },
    ]);

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildAtomicGroups()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);

    const channelTrigger = document.querySelector(
      "[data-channel-select-trigger='claude']",
    ) as HTMLButtonElement;
    expect(channelTrigger).toBeTruthy();
    fireEvent.click(channelTrigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    const k3Option = await within(dialog).findByRole("button", {
      name: /^k3$/,
    });
    fireEvent.click(k3Option);

    expect(onOpenProviderProfile).toHaveBeenCalledWith("claude", "k3");
    await waitFor(() => {
      expect(onExecutionTargetChange).toHaveBeenCalledWith({
        engine: "claude",
        providerProfileId: "k3",
        modelCatalogEntryId: "kimi-k3",
        model: "kimi-k3",
        providerProfileNameSnapshot: "k3",
        providerProfileSource: "managed",
        reasoning: null,
      });
    });
  });

  it("does not keep previous channel model when shared provider catalog is still empty", async () => {
    const onExecutionTargetChange = vi.fn();
    const onOpenProviderProfile = vi.fn().mockResolvedValue([]);
    const groups = buildAtomicGroups();
    // 模拟 Shared 刚切渠道、catalog 尚未返回
    const k3 = groups[0].profiles.find((p) => p.id === "k3");
    if (k3) {
      k3.models = [];
    }

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await userEvent.setup({ pointerEventsCheck: 0 }).click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    openPickerSubmenu(/Claude Code/);
    fireEvent.click(
      document.querySelector(
        "[data-channel-select-trigger='claude']",
      ) as HTMLButtonElement,
    );
    fireEvent.click(
      await within(await screen.findByRole("dialog")).findByRole("button", {
        name: /^k3$/,
      }),
    );

    await waitFor(() => {
      expect(onOpenProviderProfile).toHaveBeenCalledWith("claude", "k3");
    });
    // 无新 catalog 时不得把旧 local 的 claude-opus-4-8 写进新渠道 target
    await new Promise((r) => setTimeout(r, 50));
    expect(onExecutionTargetChange).not.toHaveBeenCalled();
  });

  it("writes execution target immediately when switching another engine channel (codex→claude managed)", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const onOpenProviderProfile = vi.fn().mockResolvedValue([
      {
        id: "claude-fable-5",
        model: "deepseek-v4-pro",
        label: "deepseek-v4-pro",
        providerProfileId: "deepseek",
      },
    ]);
    // 当前 Shared 还在 Codex，用户在 Claude 组切 DeepSeek——必须立刻落盘 target，
    // 不能只 override UI 却仍显示「本地配置」。
    const codexTarget = {
      engine: "codex" as const,
      providerProfileId: null,
      modelCatalogEntryId: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk" as const,
      reasoning: null,
    };
    const groups = buildAtomicGroups();
    groups[0].profiles.push({
      id: "deepseek",
      label: "DeepSeek",
      source: "managed" as const,
      loading: false,
      error: null,
      models: [
        {
          id: "claude-fable-5",
          model: "deepseek-v4-pro",
          label: "deepseek-v4-pro",
        },
      ],
    });

    render(
      <ModelSelect
        value="gpt-5.6-sol"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={codexTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:gpt-5.6-sol" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Claude Code/);

    const channelTrigger = document.querySelector(
      "[data-channel-select-trigger='claude']",
    ) as HTMLButtonElement;
    expect(channelTrigger).toBeTruthy();
    fireEvent.click(channelTrigger);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /DeepSeek/ }),
    );

    expect(onOpenProviderProfile).toHaveBeenCalledWith("claude", "deepseek");
    await waitFor(() => {
      expect(onExecutionTargetChange).toHaveBeenCalledWith({
        engine: "claude",
        providerProfileId: "deepseek",
        modelCatalogEntryId: "claude-fable-5",
        model: "deepseek-v4-pro",
        providerProfileNameSnapshot: "DeepSeek",
        providerProfileSource: "managed",
        reasoning: null,
      });
    });
  });

  it("writes codex managed channel target when previewing from a claude active target", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const onOpenProviderProfile = vi.fn().mockResolvedValue([
      { id: "gpt-provider-b", model: "gpt-provider-b", label: "GPT Provider B" },
    ]);
    const groups = buildAtomicGroups();
    groups[1].profiles.push({
      id: "provider-b",
      label: "Provider B",
      source: "managed" as const,
      loading: false,
      error: null,
      models: [{ id: "gpt-provider-b", label: "GPT Provider B" }],
    });

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        onOpenProviderProfile={onOpenProviderProfile}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Codex CLI/ });
    openPickerSubmenu(/Codex CLI/);

    const channelTrigger = document.querySelector(
      "[data-channel-select-trigger='codex']",
    ) as HTMLButtonElement;
    expect(channelTrigger).toBeTruthy();
    fireEvent.click(channelTrigger);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Provider B/ }),
    );

    expect(onOpenProviderProfile).toHaveBeenCalledWith("codex", "provider-b");
    await waitFor(() => {
      expect(onExecutionTargetChange).toHaveBeenCalledWith({
        engine: "codex",
        providerProfileId: "provider-b",
        modelCatalogEntryId: "gpt-provider-b",
        model: "gpt-provider-b",
        providerProfileNameSnapshot: "Provider B",
        providerProfileSource: "managed",
        reasoning: null,
      });
    });
  });

  it("disables unavailable engine groups with the disabled reason", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const groups = buildAtomicGroups();
    const kimiGroup = {
      providerId: "kimi" as const,
      providerLabel: "Kimi CLI",
      enabled: false,
      disabledReason: "可作为来源；目标续接尚未验证",
      profiles: [
        {
          id: "__local_config_toml__",
          label: "本地配置",
          source: "disk" as const,
          loading: false,
          error: null,
          models: [{ id: "kimi-for-coding", label: "Kimi For Coding" }],
        },
      ],
    };

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={[...groups, kimiGroup]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );

    const kimiTrigger = await screen.findByRole("menuitem", { name: /Kimi CLI/ });
    expect(kimiTrigger.getAttribute("data-disabled")).not.toBeNull();
    expect(kimiTrigger.getAttribute("title")).toBe("可作为来源；目标续接尚未验证");
  });

  it("shows the selected target model instead of the previous engine catalog", () => {
    render(
      <ModelSelect
        value="codex-target-model"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        models={[{ id: "claude-old-model", label: "Old Claude Model" }]}
        executionTarget={{
          engine: "codex",
          providerProfileId: "provider-b",
          modelCatalogEntryId: "codex-target-model",
          model: "codex-target-model",
          providerProfileNameSnapshot: "Provider B",
          providerProfileSource: "managed",
        }}
        targetGroups={[
          {
            providerId: "codex",
            providerLabel: "Codex CLI",
            enabled: true,
            profiles: [
              {
                id: "provider-b",
                label: "Provider B",
                source: "managed",
                loading: false,
                error: null,
                models: [
                  {
                    id: "codex-target-model",
                    label: "Provider B Model",
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole("button").textContent).toContain(
      "Provider B Model",
    );
    expect(screen.getByRole("button").textContent).not.toContain(
      "models.selectModel",
    );
  });
});

describe("buildProviderExecutionTarget", () => {
  it("builds an atomic Shared target without inferring from model id", () => {
    expect(
      buildProviderExecutionTarget(
        {
          engine: "claude",
          providerProfileId: "provider-a",
          model: "same-model",
          reasoning: { effort: "high" },
        },
        "codex",
        "provider-b",
        "same-model",
        "Provider B",
        "managed",
        true,
        "same-model",
      ),
    ).toEqual({
      engine: "codex",
      providerProfileId: "provider-b",
      modelCatalogEntryId: "same-model",
      model: "same-model",
      providerProfileNameSnapshot: "Provider B",
      providerProfileSource: "managed",
      reasoning: null,
    });
  });

  it("seeds Codex catalog model default effort when switching from Grok", () => {
    // Cross-engine: Grok high MUST NOT inherit; gpt-5.6-sol default is low.
    expect(
      buildProviderExecutionTarget(
        {
          engine: "grok",
          providerProfileId: null,
          modelCatalogEntryId: "grok-4-1-fast",
          model: "grok-4-1-fast",
          reasoning: { effort: "high" },
        },
        "codex",
        "__disk__",
        "gpt-5.6-sol",
        "Local disk",
        "disk",
        true,
        "gpt-5.6-sol",
      ),
    ).toEqual(
      expect.objectContaining({
        engine: "codex",
        modelCatalogEntryId: "gpt-5.6-sol",
        model: "gpt-5.6-sol",
        reasoning: { effort: "low" },
      }),
    );
  });

  it("keeps same-profile effort when the next Codex model still supports it", () => {
    expect(
      buildProviderExecutionTarget(
        {
          engine: "codex",
          providerProfileId: null,
          modelCatalogEntryId: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          reasoning: { effort: "high" },
        },
        "codex",
        "__disk__",
        "gpt-5.6-terra",
        "Local disk",
        "disk",
        true,
        "gpt-5.6-terra",
      ),
    ).toEqual(
      expect.objectContaining({
        modelCatalogEntryId: "gpt-5.6-terra",
        reasoning: { effort: "high" },
      }),
    );
  });

  it("normalizes local profile sentinels to the canonical default binding", () => {
    expect(
      buildProviderExecutionTarget(
        {
          engine: "claude",
          providerProfileId: null,
          model: "claude-sonnet",
          reasoning: { effort: "high" },
        },
        "claude",
        "__local_settings_json__",
        "claude-opus",
        "本地配置",
        "disk",
        true,
        "claude-opus",
      ),
    ).toEqual({
      engine: "claude",
      providerProfileId: null,
      modelCatalogEntryId: "claude-opus",
      model: "claude-opus",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
      reasoning: { effort: "high" },
    });
  });

  it("keeps catalog identity but freezes the runtime model for execution", () => {
    expect(
      buildProviderExecutionTarget(
        null,
        "claude",
        "provider-b",
        "settings-reasoning",
        "Provider B",
        "managed",
        false,
        "deepseek-v4-pro",
      ),
    ).toMatchObject({
      engine: "claude",
      providerProfileId: "provider-b",
      modelCatalogEntryId: "settings-reasoning",
      model: "deepseek-v4-pro",
    });
  });

  it("does not synthesize a missing runtime model from catalog identity", () => {
    expect(
      buildProviderExecutionTarget(
        null,
        "claude",
        "provider-b",
        "settings-reasoning",
        "Provider B",
        "managed",
      ),
    ).toMatchObject({
      modelCatalogEntryId: "settings-reasoning",
      model: null,
    });
  });

  it("treats local sentinel and null as the same native provider binding", () => {
    expect(
      isSameProviderExecutionProfile("claude", null, {
        engine: "claude",
        providerProfileId: "__local_settings_json__",
      }),
    ).toBe(true);
    expect(
      isSameProviderExecutionProfile("claude", "provider-a", {
        engine: "claude",
        providerProfileId: "provider-b",
      }),
    ).toBe(false);
  });
});

describe("resolveClaudeCatalogModelLabel", () => {
  const staleMapping = {
    fable: "MiniMax-M3",
    opus: "MiniMax-M3",
    sonnet: "MiniMax-M3",
    haiku: "MiniMax-M3",
  };

  it("prefers local catalog runtime over stale global mapping", () => {
    // 历史 Shared 打开本地渠道：forceRefresh 已写入 deepseek，但 localStorage
    // 仍可能是上一 managed MiniMax 映射。
    expect(
      resolveClaudeCatalogModelLabel(
        {
          id: "claude-opus-5",
          model: "deepseek-v4-pro",
          label: "deepseek-v4-pro",
        },
        staleMapping,
      ),
    ).toBe("deepseek-v4-pro");
  });

  it("prefers managed catalog runtime even when mapping disagrees", () => {
    expect(
      resolveClaudeCatalogModelLabel(
        {
          id: "claude-sonnet-5",
          model: "kimi-k3",
          label: "kimi-k3",
          providerProfileId: "k3",
        },
        staleMapping,
      ),
    ).toBe("kimi-k3");
  });

  it("falls back to global mapping when catalog runtime equals id", () => {
    expect(
      resolveClaudeCatalogModelLabel(
        {
          id: "claude-opus-5",
          model: "claude-opus-5",
          label: "Opus 5",
        },
        { opus: "MiniMax-M3" },
      ),
    ).toBe("MiniMax-M3");
  });
});

describe("resolveModelIdForIcon", () => {
  it("uses catalog runtime for icon when mapping still points at another vendor", () => {
    // 文案已是 k3，图标不得再跟 stale deepseek mapping 画鲸。
    expect(
      resolveModelIdForIcon(
        {
          id: "claude-sonnet-5",
          model: "k3",
          label: "k3",
        },
        {
          sonnet: "deepseek-v4-pro",
          main: "deepseek-v4-pro",
        },
        "claude",
      ),
    ).toBe("k3");
  });

  it("still uses mapping for icon when catalog has no runtime rewrite", () => {
    expect(
      resolveModelIdForIcon(
        {
          id: "claude-opus-5",
          model: "claude-opus-5",
          label: "Opus 5",
        },
        { opus: "kimi-k3" },
        "claude",
      ),
    ).toBe("kimi-k3");
  });
});

describe("resolveActiveProviderProfileId", () => {
  it("uses the target channel for the current engine", () => {
    expect(
      resolveActiveProviderProfileId("claude", {
        engine: "claude",
        providerProfileId: "k3",
      }),
    ).toBe("k3");
  });

  it("falls back to the local default channel for the current engine", () => {
    expect(
      resolveActiveProviderProfileId("claude", {
        engine: "claude",
        providerProfileId: null,
      }),
    ).toBe("__local_settings_json__");
    expect(
      resolveActiveProviderProfileId("claude", {
        engine: "claude",
        providerProfileId: "__local_settings_json__",
      }),
    ).toBe("__local_settings_json__");
  });

  it("always uses the local default channel for other engines", () => {
    expect(
      resolveActiveProviderProfileId("codex", {
        engine: "claude",
        providerProfileId: "k3",
      }),
    ).toBe("__disk__");
    expect(resolveActiveProviderProfileId("grok", null)).toBe(
      "__local_config_toml__",
    );
    expect(
      resolveActiveProviderProfileId("opencode", {
        engine: "claude",
        providerProfileId: null,
      }),
    ).toBe("__local_opencode_json__");
  });

  it("uses a supplied creation-profile default when no target exists", () => {
    expect(
      resolveActiveProviderProfileId("codex", null, "doge-token-matrix"),
    ).toBe("doge-token-matrix");
    expect(
      resolveActiveProviderProfileId(
        "codex",
        { engine: "codex", providerProfileId: "provider-explicit" },
        "doge-token-matrix",
      ),
    ).toBe("provider-explicit");
  });

  it("returns null for engines without provider profiles", () => {
    expect(resolveActiveProviderProfileId("gemini", null)).toBeNull();
  });
});

describe("ModelSelect empty channel models and custom reasoning defaults", () => {
  function openPickerSubmenu(name: RegExp) {
    const trigger = screen.getByRole("menuitem", { name });
    fireEvent.click(trigger);
    return trigger;
  }

  function buildGroupsWithEmptyCodex(): ProviderTargetGroup[] {
    const groups = buildAtomicGroups();
    groups[1].profiles[0].models = [];
    return groups;
  }

  it("shows two-line guidance and keeps the add-model entry when a channel has no models", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onAddModel = vi.fn();

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onAddModel={onAddModel}
        onExecutionTargetChange={vi.fn()}
        executionTarget={atomicExecutionTarget}
        targetGroups={buildGroupsWithEmptyCodex()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Claude Code/ });
    openPickerSubmenu(/Codex CLI/);

    const emptyRow = document.querySelector(
      "[data-empty-channel-models='codex']",
    );
    expect(emptyRow).toBeTruthy();
    expect(emptyRow?.textContent).toContain("models.emptyChannelModelsTitle");
    expect(emptyRow?.textContent).toContain("models.emptyChannelModelsHint");
    expect(emptyRow?.getAttribute("aria-disabled")).toBe("true");

    // 「添加模型」入口仍在底栏，引导文案指向它。
    const footer = document.querySelector(
      "[data-submenu-footer='codex']",
    ) as HTMLElement;
    expect(footer).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "models.addModel" })).toBeTruthy();
  });

  it("seeds default medium reasoning when a custom Codex model is picked", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const groups = buildAtomicGroups();
    groups[1].profiles[0].models = [
      {
        id: "my-custom-model",
        label: "My Custom Model",
        source: "custom",
      },
    ];

    render(
      <ModelSelect
        value="claude-opus-4-8"
        currentProvider="claude"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        executionTarget={atomicExecutionTarget}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:Opus 4.8" }),
    );
    await screen.findByRole("menuitem", { name: /Codex CLI/ });
    openPickerSubmenu(/Codex CLI/);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /My Custom Model/ }),
    );

    expect(onExecutionTargetChange).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        providerProfileId: null,
        modelCatalogEntryId: "my-custom-model",
        model: "my-custom-model",
        providerProfileNameSnapshot: "Local disk",
        reasoning: { effort: "medium" },
      }),
    );
  });

  it("keeps the user-selected effort when switching to a custom Codex model", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onExecutionTargetChange = vi.fn();
    const groups = buildAtomicGroups();
    groups[1].profiles[0].models = [
      {
        id: "my-custom-model",
        label: "My Custom Model",
        source: "custom",
      },
    ];

    render(
      <ModelSelect
        value="my-custom-model"
        currentProvider="codex"
        triggerVariant="readiness"
        onChange={vi.fn()}
        onExecutionTargetChange={onExecutionTargetChange}
        executionTarget={{
          engine: "codex",
          providerProfileId: null,
          modelCatalogEntryId: "gpt-5.7",
          model: "gpt-5.7",
          providerProfileNameSnapshot: "Local disk",
          providerProfileSource: "disk",
          reasoning: { effort: "high" },
        }}
        targetGroups={groups}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "chat.currentModel:My Custom Model" }),
    );
    await screen.findByRole("menuitem", { name: /Codex CLI/ });
    openPickerSubmenu(/Codex CLI/);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /My Custom Model/ }),
    );

    expect(onExecutionTargetChange).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        providerProfileId: null,
        reasoning: { effort: "high" },
      }),
    );
  });
});
