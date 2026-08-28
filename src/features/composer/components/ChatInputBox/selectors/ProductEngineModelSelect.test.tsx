// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ExecutionTarget } from "../../../../shared-session/target/types";
import type { ProductModelViewV1 } from "../../../../account/runtime/productOnboardingClient";
import { projectProductTargetCatalogV1 } from "../../../../account/runtime/productTargetCatalog";
import type { ProductTargetCatalogV1 } from "../types";
import { ProductEngineModelSelect } from "./ProductEngineModelSelect";

const refreshModels = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

vi.mock("../../../../engine/components/EngineIcon", () => ({
  EngineIcon: ({ engine }: { engine: string }) => (
    <span data-engine-icon={engine} />
  ),
}));

vi.mock("../../../../account/runtime/productModelCatalogRefresh", () => ({
  refreshProductModelsV1: refreshModels,
}));

const rawModels: ProductModelViewV1[] = [
    productModel("gpt-5.6-sol", "GPT-5.6 Sol", [
      "openai-responses",
      "openai-chat-completions",
    ]),
    productModel("gpt-5.5", "GPT-5.5", [
      "openai-responses",
      "openai-chat-completions",
    ]),
    productModel("claude-sonnet-4-8", "Claude Sonnet 4.8", [
      "anthropic-messages",
    ]),
    productModel("kimi-for-coding", "Kimi For Coding", [
      "openai-responses",
      "openai-chat-completions",
    ]),
    productModel("kimi-for-coding-highspeed", "Kimi For Coding Highspeed", [
      "openai-responses",
      "openai-chat-completions",
    ]),
];

const catalog: ProductTargetCatalogV1 = productCatalog(rawModels);

const initialTarget: ExecutionTarget = {
  engine: "codex",
  providerProfileId: "doge-token-matrix",
  modelCatalogEntryId: "gpt-5.6-sol",
  model: "gpt-5.6-sol",
  reasoning: { effort: "high" },
  providerProfileNameSnapshot: "Doge",
  providerProfileSource: "managed",
};

describe("ProductEngineModelSelect", () => {
  it("commits an engine and model atomically while keeping the panel open", () => {
    const changes: ExecutionTarget[] = [];

    function Harness() {
      const [target, setTarget] = useState(initialTarget);
      return (
        <ProductEngineModelSelect
          catalog={catalog}
          executionTarget={target}
          onExecutionTargetChange={(next) => {
            changes.push(next);
            setTarget(next);
          }}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /当前组合/ }));

    expect(screen.getByRole("dialog", { name: "选择引擎与模型" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.queryByText("切换渠道")).toBeNull();
    expect(screen.queryByText("添加模型")).toBeNull();
    expect(screen.queryByText(/Doge 订阅已生效/)).toBeNull();
    expect(screen.getByRole("dialog").querySelector("footer")).toBeNull();
    expect(screen.getByRole("radio", { name: /Kimi For Coding$/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Claude" }));
    expect(changes).toHaveLength(0);
    expect(screen.getByRole("radio", { name: /Claude Sonnet 4.8/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Claude Sonnet 4.8/ }));
    expect(changes.at(-1)).toMatchObject({
      engine: "claude",
      modelCatalogEntryId: "claude-sonnet-4-8",
      model: "claude-sonnet-4-8",
      providerProfileId: "doge-token-matrix",
      providerProfileNameSnapshot: "Doge",
    });
    expect(screen.getByRole("dialog", { name: "选择引擎与模型" })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    expect(changes).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: /GPT-5.5/ }));
    expect(changes.at(-1)).toMatchObject({
      engine: "codex",
      modelCatalogEntryId: "gpt-5.5",
      model: "gpt-5.5",
      providerProfileId: "doge-token-matrix",
      providerProfileNameSnapshot: "Doge",
    });
    expect(screen.getByRole("dialog", { name: "选择引擎与模型" })).toBeTruthy();
  });

  it("does not bridge a Kimi source model while choosing Codex Sol", () => {
    const onExecutionTargetChange = vi.fn();
    const doubao = productModel("豆包", "豆包", [
      "openai-responses",
      "openai-chat-completions",
      "anthropic-messages",
    ]);
    render(
      <ProductEngineModelSelect
        catalog={productCatalog([doubao, ...rawModels])}
        executionTarget={{
          ...initialTarget,
          engine: "kimi",
          modelCatalogEntryId: "豆包",
          model: "豆包",
          reasoning: null,
        }}
        onExecutionTargetChange={onExecutionTargetChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /当前组合/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));

    expect(onExecutionTargetChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /GPT-5.6 Sol/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /GPT-5.6 Sol/ }));
    expect(onExecutionTargetChange).toHaveBeenCalledOnce();
    expect(onExecutionTargetChange).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        modelCatalogEntryId: "gpt-5.6-sol",
        model: "gpt-5.6-sol",
        providerProfileId: "doge-token-matrix",
      }),
    );
  });

  it("keeps Kimi-family models available in Codex and Kimi", () => {
    const onExecutionTargetChange = vi.fn();
    render(
      <ProductEngineModelSelect
        catalog={catalog}
        executionTarget={initialTarget}
        onExecutionTargetChange={onExecutionTargetChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /当前组合/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Kimi For Coding$/ }));
    expect(onExecutionTargetChange).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        modelCatalogEntryId: "kimi-for-coding",
        model: "kimi-for-coding",
        providerProfileId: "doge-token-matrix",
      }),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Kimi CLI" }));
    fireEvent.click(screen.getByRole("radio", { name: /Kimi For Coding$/ }));

    expect(onExecutionTargetChange).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "kimi",
        modelCatalogEntryId: "kimi-for-coding",
        model: "kimi-for-coding",
        providerProfileId: "doge-token-matrix",
      }),
    );
  });

  it("searches only the selected engine's compatible dynamic models and closes with Escape", () => {
    render(
      <ProductEngineModelSelect
        catalog={catalog}
        executionTarget={{
          ...initialTarget,
          engine: "kimi",
          modelCatalogEntryId: "kimi-for-coding",
          model: "kimi-for-coding",
          reasoning: null,
        }}
        onExecutionTargetChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /当前组合/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索模型" }), {
      target: { value: "kimi" },
    });

    expect(screen.getByRole("radio", { name: /Kimi For Coding$/ })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /GPT-5.6 Sol/ })).toBeNull();
    expect(screen.getByText("Kimi For Coding Highspeed")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables an engine when the entitlement catalog has no compatible model for it", () => {
    render(
      <ProductEngineModelSelect
        catalog={{
          ...catalog,
          engines: catalog.engines.map((engine) =>
            engine.id === "claude" ? { ...engine, models: [] } : engine,
          ),
        }}
        executionTarget={initialTarget}
        onExecutionTargetChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /当前组合/ }));
    expect(
      (screen.getByRole("radio", { name: /^Claude/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("keeps last-known models visible and exposes a scoped manual refresh", () => {
    render(
      <ProductEngineModelSelect
        catalog={{ ...catalog, modelsStatus: "stale" }}
        executionTarget={initialTarget}
        onExecutionTargetChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /当前组合/ }));
    expect(screen.getByText(/当前仍显示上次结果/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "刷新模型目录" }));
    expect(refreshModels).toHaveBeenCalledWith({ force: true });
    expect(screen.getAllByText("GPT-5.6 Sol")).toHaveLength(2);
  });

  it("shows the upstream display name without exposing a different runtime model", () => {
    const doubao = {
      ...productModel("doubao-entry", "豆包", ["openai-responses"]),
      model: "ark-code-latest",
    };
    render(
      <ProductEngineModelSelect
        catalog={productCatalog([doubao], [
          { id: "codex", displayName: "Codex" },
        ])}
        executionTarget={{
          ...initialTarget,
          modelCatalogEntryId: doubao.id,
          model: doubao.model,
        }}
        onExecutionTargetChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /当前组合/ }));
    expect(screen.getByRole("radio", { name: "豆包" })).toBeTruthy();
    expect(screen.queryByText("ark-code-latest")).toBeNull();

    const triggerIcon = screen
      .getByRole("button", { name: /当前组合/ })
      .querySelector(".selector-model-brand-icon");
    const triggerImage = triggerIcon?.querySelector("img");
    expect((triggerIcon as HTMLElement | null)?.style.width).toBe("16px");
    expect((triggerIcon as HTMLElement | null)?.style.height).toBe("16px");
    expect((triggerIcon as HTMLElement | null)?.style.overflow).toBe("hidden");
    expect(triggerImage?.style.width).toBe("16px");
    expect(triggerImage?.style.height).toBe("16px");
  });
});

function productModel(
  id: string,
  displayName: string,
  apiProtocols: ProductModelViewV1["apiProtocols"],
): ProductModelViewV1 {
  return {
    id,
    displayName,
    model: id,
    apiProtocols,
    capabilities: [],
  };
}

function productCatalog(
  models: readonly ProductModelViewV1[],
  engines: Parameters<typeof projectProductTargetCatalogV1>[0]["engines"] = [
    { id: "codex", displayName: "Codex" },
    { id: "claude-code", displayName: "Claude" },
    { id: "kimi", displayName: "Kimi CLI" },
  ],
): ProductTargetCatalogV1 {
  return projectProductTargetCatalogV1({
    engines,
    models,
    modelsStatus: "ready",
    modelsUpdatedAt: 1_893_456_000_000,
  });
}
