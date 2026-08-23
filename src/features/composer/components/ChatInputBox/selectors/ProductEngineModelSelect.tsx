import CheckIcon from "lucide-react/dist/esm/icons/check";
import SearchIcon from "lucide-react/dist/esm/icons/search";
import RefreshCwIcon from "lucide-react/dist/esm/icons/refresh-cw";
import XIcon from "lucide-react/dist/esm/icons/x";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { EngineIcon } from "../../../../engine/components/EngineIcon";
import { useAccountExperienceCopyV1 } from "../../../../account/hooks/useAccountExperienceCopy";
import { MANAGED_PROVIDER_PROFILE_ID_V1 } from "../../../../account/runtime/engineEntitlementStore";
import { refreshProductModelsV1 } from "../../../../account/runtime/productModelCatalogRefresh";
import {
  PRODUCT_MANAGED_PROVIDER_LABEL,
  resolveProductRuntimeModelIdV1,
} from "../../../../account/runtime/productExecutionTarget";
import {
  compatibleProductModelsForEngineV1,
  productModelMatchesIdentityV1,
} from "../../../../account/runtime/productModelCompatibility";
import {
  groupProductModelsForDisplay,
  type ProductModelVendorGroupId,
} from "../../../../vendors/productModelGrouping";
import { ProviderBrandIconImg } from "../../../../vendors/components/ProviderBrandIconImg";
import { resolveProviderBrandIcon } from "../../../../vendors/providerBrandIcon";
import type { ExecutionTarget } from "../../../../shared-session/target/types";
import type { ProductTargetCatalogV1 } from "../types";
import "../styles/product-engine-model-panel.css";

type ProductEngineModelSelectProps = {
  readonly catalog: ProductTargetCatalogV1;
  readonly executionTarget: ExecutionTarget | null | undefined;
  readonly onExecutionTargetChange: (target: ExecutionTarget) => void;
};

export const ProductEngineModelSelect = memo(function ProductEngineModelSelect({
  catalog,
  executionTarget,
  onExecutionTargetChange,
}: ProductEngineModelSelectProps) {
  const copy = useAccountExperienceCopyV1();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedEngine =
    catalog.engines.find((engine) => engine.id === executionTarget?.engine) ??
    catalog.engines[0] ??
    null;
  const compatibleModels = useMemo(
    () =>
      selectedEngine
        ? compatibleProductModelsForEngineV1(selectedEngine.id, catalog.models)
        : [],
    [catalog.models, selectedEngine],
  );
  const selectedModel =
    compatibleModels.find(
      (model) =>
        productModelMatchesIdentityV1(
          model,
          executionTarget?.modelCatalogEntryId,
        ) || productModelMatchesIdentityV1(model, executionTarget?.model),
    ) ??
    compatibleModels[0] ??
    null;
  const modelGroups = useMemo(
    () => groupProductModelsForDisplay(compatibleModels, query),
    [compatibleModels, query],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshProductModelsV1();
    window.requestAnimationFrame(() => searchRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  const publishTarget = useCallback(
    (
      engine: ProductTargetCatalogV1["engines"][number],
      model: ProductTargetCatalogV1["models"][number],
    ) => {
      onExecutionTargetChange({
        engine: engine.id,
        providerProfileId: MANAGED_PROVIDER_PROFILE_ID_V1,
        modelCatalogEntryId: model.id,
        model: resolveProductRuntimeModelIdV1(model),
        reasoning:
          executionTarget?.engine === engine.id
            ? (executionTarget.reasoning ?? null)
            : null,
        providerProfileNameSnapshot: PRODUCT_MANAGED_PROVIDER_LABEL,
        providerProfileSource: "managed",
      });
    },
    [executionTarget, onExecutionTargetChange],
  );

  const panel =
    open && typeof document !== "undefined"
      ? createPortal(
          <div className="product-engine-model-layer">
            <button
              type="button"
              className="product-engine-model-scrim"
              aria-label={copy.productPickerClose}
              onClick={close}
            />
            <aside
              className="product-engine-model-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="product-engine-model-title"
            >
              <header className="product-engine-model-header">
                <h2 id="product-engine-model-title">
                  {copy.productPickerTitle}
                </h2>
                <div className="product-engine-model-header-actions">
                  <button
                    type="button"
                    className="product-engine-model-refresh"
                    aria-label={copy.productPickerRefresh}
                    title={copy.productPickerRefresh}
                    disabled={catalog.modelsStatus === "refreshing"}
                    onClick={() => void refreshProductModelsV1({ force: true })}
                  >
                    <RefreshCwIcon
                      aria-hidden
                      data-spinning={catalog.modelsStatus === "refreshing" ? "true" : "false"}
                    />
                  </button>
                  <button
                    type="button"
                    className="product-engine-model-close"
                    aria-label={copy.productPickerClose}
                    onClick={close}
                  >
                    <XIcon aria-hidden />
                  </button>
                </div>
              </header>

              <section className="product-engine-model-section">
                <h3>{copy.productPickerEngine}</h3>
                <div
                  className="product-engine-options"
                  role="radiogroup"
                  aria-label={copy.productPickerEngine}
                >
                  {catalog.engines.map((engine) => {
                    const selected = engine.id === selectedEngine?.id;
                    const engineModels = compatibleProductModelsForEngineV1(
                      engine.id,
                      catalog.models,
                    );
                    const nextModel =
                      engineModels.find(
                        (model) => model.id === selectedModel?.id,
                      ) ??
                      engineModels[0] ??
                      null;
                    return (
                      <button
                        type="button"
                        className="product-engine-option"
                        key={engine.id}
                        role="radio"
                        aria-checked={selected}
                        aria-label={
                          nextModel
                            ? engine.displayName
                            : `${engine.displayName} · ${copy.productPickerEngineUnavailable}`
                        }
                        title={
                          nextModel
                            ? undefined
                            : copy.productPickerEngineUnavailable
                        }
                        data-selected={selected ? "true" : "false"}
                        disabled={nextModel === null}
                        onClick={() => {
                          if (nextModel) publishTarget(engine, nextModel);
                        }}
                      >
                        <EngineIcon engine={engine.id} size={19} />
                        <span>{engine.displayName}</span>
                        <span className="product-picker-radio" aria-hidden />
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="product-engine-model-section product-model-section">
                <h3>{copy.productPickerModel}</h3>
                <label className="product-model-search">
                  <SearchIcon aria-hidden />
                  <input
                    ref={searchRef}
                    value={query}
                    type="search"
                    aria-label={copy.productPickerSearch}
                    placeholder={copy.productPickerSearch}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                  />
                </label>
                <div
                  className="product-model-options"
                  role="radiogroup"
                  aria-label={copy.productPickerModel}
                >
                  {modelGroups.length > 0 ? (
                    modelGroups.map((group) => (
                      <div className="product-model-group" key={group.id}>
                        <p className="product-model-group-heading">
                          {productVendorLabel(group.id, copy)}
                        </p>
                        {group.models.map((model) => {
                          const selected = model.id === selectedModel?.id;
                          return (
                            <button
                              type="button"
                              className="product-model-option"
                              key={model.id}
                              role="radio"
                              aria-checked={selected}
                              data-selected={selected ? "true" : "false"}
                              onClick={() => {
                                if (selectedEngine)
                                  publishTarget(selectedEngine, model);
                              }}
                            >
                              <ProductModelIcon
                                modelId={model.id}
                                displayName={model.displayName}
                                runtimeModel={model.model}
                                engine={selectedEngine?.id}
                              />
                              <span className="product-model-copy">
                                <strong>{model.displayName}</strong>
                              </span>
                              <CheckIcon
                                className="product-model-check"
                                aria-hidden
                              />
                            </button>
                          );
                        })}
                      </div>
                    ))
                  ) : (
                    <p className="product-model-empty">
                      {copy.productPickerEmpty}
                    </p>
                  )}
                </div>
              </section>

              <footer
                className="product-engine-model-footer"
                data-status={catalog.modelsStatus}
                aria-live="polite"
              >
                <span className="product-subscription-dot" aria-hidden />
                <span>
                  {catalog.modelsStatus === "refreshing"
                    ? copy.productPickerRefreshing
                    : catalog.modelsStatus === "stale"
                      ? copy.productPickerRefreshFailed
                      : copy.productPickerSubscriptionActive}
                </span>
              </footer>
            </aside>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="composer-readiness-target composer-readiness-target-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={copy.productPickerCurrentTarget
          .replace("{engine}", selectedEngine?.displayName ?? "—")
          .replace("{model}", selectedModel?.displayName ?? "—")}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="product-picker-engine-icon" aria-hidden>
          {selectedEngine ? (
            <EngineIcon engine={selectedEngine.id} size={16} />
          ) : null}
        </span>
        <span className="composer-readiness-icon" aria-hidden>
          <ProductModelIcon
            modelId={selectedModel?.id ?? ""}
            displayName={selectedModel?.displayName}
            runtimeModel={selectedModel?.model}
            engine={selectedEngine?.id}
          />
        </span>
        <span className="composer-readiness-model">
          {selectedModel?.displayName ?? copy.productPickerModel}
        </span>
      </button>
      {panel}
    </>
  );
});

function ProductModelIcon({
  modelId,
  displayName,
  runtimeModel,
  engine,
}: {
  readonly modelId: string;
  readonly displayName?: string;
  readonly runtimeModel?: string;
  readonly engine?: ProductTargetCatalogV1["engines"][number]["id"];
}) {
  const src = [modelId, runtimeModel, displayName]
    .map((identity) => resolveProviderBrandIcon({ modelId: identity }))
    .find((candidate) => candidate !== null) ?? null;
  if (src) {
    return (
      <span className="selector-model-brand-icon" aria-hidden>
        <ProviderBrandIconImg src={src} />
      </span>
    );
  }
  return engine ? <EngineIcon engine={engine} size={16} /> : null;
}

function productVendorLabel(
  id: ProductModelVendorGroupId,
  copy: ReturnType<typeof useAccountExperienceCopyV1>,
): string {
  return {
    openai: copy.productVendorOpenAI,
    anthropic: copy.productVendorAnthropic,
    doubao: copy.productVendorDoubao,
    kimi: copy.productVendorKimi,
    zhipu: copy.productVendorZhipu,
    deepseek: copy.productVendorDeepSeek,
    bailian: copy.productVendorBailian,
    minimax: copy.productVendorMiniMax,
    xiaomi: copy.productVendorXiaomi,
    longcat: copy.productVendorLongCat,
    opencode: copy.productVendorOpenCode,
    openrouter: copy.productVendorOpenRouter,
    other: copy.productVendorOther,
  }[id];
}
