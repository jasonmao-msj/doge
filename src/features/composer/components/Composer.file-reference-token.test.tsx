/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ComposerEditorSettings,
  EngineType,
  MessageSendOptions,
} from "../../../types";
import type {
  CodeAnnotationDraftInput,
  CodeAnnotationSelection,
} from "../../code-annotations/types";
import {
  buildCodeAnnotationDedupeKey,
  createCodeAnnotationSelection,
} from "../../code-annotations/utils/codeAnnotations";
import { Composer } from "./Composer";
import {
  getSharedTargetState,
  resetSharedTargetStoreForTests,
  selectNextTarget,
} from "../../shared-session/target/targetStore";
import {
  dispatchSharedSendEvent,
  getSharedSendState,
  resetSharedSendStateStoreForTests,
} from "../../shared-session/runtime/sharedSendStateStore";
import { subscribeProviderContinuationDialogRequests } from "../../threads/services/providerContinuationRequests";
import { pushErrorToast } from "../../../services/toasts";
import {
  clearManagedEngineEntitlementsV1,
  markManagedEnginePreparedV1,
  publishManagedEngineEntitlementsV1,
} from "../../account/runtime/engineEntitlementStore";
import { subscribeAccountEngineSwitchV1 } from "../../account/runtime/engineSwitchSignal";
import {
  clearProductEntitlementV1,
  publishProductReadyV1,
} from "../../account/runtime/productEntitlementStore";

afterEach(() => {
  cleanup();
  resetSharedTargetStoreForTests();
  resetSharedSendStateStoreForTests();
  clearManagedEngineEntitlementsV1();
  clearProductEntitlementV1();
});

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(null);
  vi.mocked(pushErrorToast).mockReset();
});

vi.mock("../../../services/dragDrop", () => ({
  subscribeWindowDragDrop: vi.fn(() => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://${path}`,
  invoke: vi.fn(async () => null),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("../../engine/components/EngineSelector", () => ({
  EngineSelector: () => null,
}));

vi.mock("./ChatInputBox/ChatInputBoxAdapter", () => ({
  ChatInputBoxAdapter: ({
    text,
    onTextChange,
    onSend,
    providerProfileId,
    selectedEffort,
    onExecutionTargetChange,
    providerTargetPickerMode,
    productTargetCatalog,
    sendReadiness,
    onSelectEffort,
  }: {
    text: string;
    onTextChange: (next: string, cursor: number | null) => void;
    onSend: () => void;
    providerProfileId?: string | null;
    selectedEffort?: string | null;
    onExecutionTargetChange?: (target: {
      engine: "claude" | "codex" | "kimi";
      providerProfileId?: string | null;
      modelCatalogEntryId?: string | null;
      model?: string | null;
      reasoning?: { effort: string } | null;
      providerProfileNameSnapshot?: string | null;
      providerProfileSource?: "disk" | "managed" | null;
    }) => void;
    providerTargetPickerMode?: "shared" | "create-session" | "product";
    productTargetCatalog?: {
      engines: readonly unknown[];
      models: readonly unknown[];
    };
    sendReadiness?: {
      target: { engine: string; modelLabel: string };
    };
    onSelectEffort?: (effort: string | null) => void;
  }) => (
    <>
      <div
        data-testid="composer-target-authority"
        data-atomic-target={String(Boolean(onExecutionTargetChange))}
        data-picker-mode={providerTargetPickerMode ?? "create-session"}
        data-product-engines={productTargetCatalog?.engines.length ?? 0}
        data-product-models={productTargetCatalog?.models.length ?? 0}
        data-readiness-engine={sendReadiness?.target.engine ?? "none"}
        data-readiness-model={sendReadiness?.target.modelLabel ?? "none"}
      />
      <textarea
        value={text}
        data-provider-profile-id={providerProfileId ?? "null"}
        data-effort={selectedEffort ?? "null"}
        onChange={(event) =>
          onTextChange(
            event.currentTarget.value,
            event.currentTarget.value.length,
          )
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSend();
          }
        }}
      />
      <button
        type="button"
        data-testid="request-provider-continuation"
        onClick={() => {
          onExecutionTargetChange?.({
            engine: "codex",
            providerProfileId: "provider-b",
            modelCatalogEntryId: "settings-reasoning",
            model: "deepseek-v4-pro",
            providerProfileNameSnapshot: "Provider B",
            providerProfileSource: "managed",
          });
        }}
      />
      <button
        type="button"
        data-testid="select-shared-target"
        onClick={() =>
          onExecutionTargetChange?.({
            engine: "codex",
            providerProfileId: "provider-b",
            modelCatalogEntryId: "settings-reasoning",
            model: "deepseek-v4-pro",
            reasoning: { effort: "high" },
            providerProfileNameSnapshot: "Provider B",
            providerProfileSource: "managed",
          })
        }
      />
      <button
        type="button"
        data-testid="navigate-shared-cli"
        onClick={() =>
          onExecutionTargetChange?.({
            engine: "claude",
            providerProfileId: null,
            modelCatalogEntryId: null,
            model: null,
            providerProfileNameSnapshot: null,
            providerProfileSource: "disk",
          })
        }
      />
      <button
        type="button"
        data-testid="select-shared-effort"
        onClick={() => onSelectEffort?.("high")}
      />
      <button
        type="button"
        data-testid="select-claude-local-target"
        onClick={() =>
          onExecutionTargetChange?.({
            engine: "claude",
            providerProfileId: null,
            modelCatalogEntryId: "settings-main",
            model: "kimi-for-coding",
            reasoning: null,
            providerProfileNameSnapshot: "本地配置",
            providerProfileSource: "disk",
          })
        }
      />
      <button
        type="button"
        data-testid="select-codex-local-target"
        onClick={() =>
          onExecutionTargetChange?.({
            engine: "codex",
            providerProfileId: null,
            modelCatalogEntryId: "local-codex",
            model: "gpt-5.5-codex",
            reasoning: null,
            providerProfileNameSnapshot: "本地配置",
            providerProfileSource: "disk",
          })
        }
      />
      <button
        type="button"
        data-testid="select-codex-token-matrix-target"
        onClick={() =>
          onExecutionTargetChange?.({
            engine: "codex",
            providerProfileId: "doge-token-matrix",
            modelCatalogEntryId: "matrix-codex",
            model: "gpt-5.5-codex",
            reasoning: { effort: "medium" },
            providerProfileNameSnapshot: "Doge",
            providerProfileSource: "managed",
          })
        }
      />
      <button
        type="button"
        data-testid="select-claude-token-matrix-target"
        onClick={() =>
          onExecutionTargetChange?.({
            engine: "claude",
            providerProfileId: "doge-token-matrix",
            modelCatalogEntryId: "claude-opus-4-8",
            model: "claude-opus-4-8",
            reasoning: null,
            providerProfileNameSnapshot: "Doge",
            providerProfileSource: "managed",
          })
        }
      />
      <button
        type="button"
        data-testid="select-product-kimi-model"
        onClick={() =>
          onExecutionTargetChange?.({
            engine: "kimi",
            providerProfileId: "doge-token-matrix",
            modelCatalogEntryId: "kimi-code/kimi-for-coding",
            model: "kimi-code/kimi-for-coding",
            reasoning: null,
            providerProfileNameSnapshot: null,
            providerProfileSource: "managed",
          })
        }
      />
      <button
        type="button"
        data-testid="select-product-doubao-model"
        onClick={() =>
          onExecutionTargetChange?.({
            engine: "kimi",
            providerProfileId: "doge-token-matrix",
            modelCatalogEntryId: "豆包",
            model: "豆包",
            reasoning: null,
            providerProfileNameSnapshot: "Doge",
            providerProfileSource: "managed",
          })
        }
      />
    </>
  ),
}));

function ComposerHarness({
  onSend,
  pendingCodeAnnotation = null,
  onCodeAnnotationConsumed,
  sharedTarget,
  createSessionTargetPicker = false,
  onCreationTargetEngineChange,
  onSelectEngine,
  onSelectModel = () => {},
  selectedEngine = "claude",
  activeThreadId = "thread-1",
  sharedTargetPickerLocked = false,
  models = [],
  selectedModelId = null,
  providerProfileId = null,
}: {
  onSend: (text: string, options?: MessageSendOptions) => void;
  pendingCodeAnnotation?: CodeAnnotationDraftInput | null;
  onCodeAnnotationConsumed?: (dedupeKey: string) => void;
  sharedTarget?: {
    providerProfileId: string;
    model: string;
    runtimeModel?: string;
    effort: string;
  };
  createSessionTargetPicker?: boolean;
  onCreationTargetEngineChange?: (engine: EngineType | null) => void;
  onSelectEngine?: (engine: EngineType) => void;
  onSelectModel?: (modelId: string) => void;
  selectedEngine?: EngineType;
  activeThreadId?: string | null;
  sharedTargetPickerLocked?: boolean;
  models?: Array<{
    id: string;
    displayName: string;
    model: string;
    providerProfileId?: string | null;
  }>;
  selectedModelId?: string | null;
  providerProfileId?: string | null;
}) {
  const [selectedCodeAnnotations, setSelectedCodeAnnotations] = useState<
    CodeAnnotationSelection[]
  >([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const handleRemoveCodeAnnotation = useCallback((annotationId: string) => {
    setSelectedCodeAnnotations((current) =>
      current.filter((annotation) => annotation.id !== annotationId),
    );
  }, []);
  const handleClearCodeAnnotations = useCallback(() => {
    setSelectedCodeAnnotations([]);
  }, []);
  useEffect(() => {
    if (!pendingCodeAnnotation) {
      return;
    }
    const selection = createCodeAnnotationSelection(pendingCodeAnnotation);
    if (!selection) {
      return;
    }
    setSelectedCodeAnnotations([selection]);
    onCodeAnnotationConsumed?.(
      buildCodeAnnotationDedupeKey(pendingCodeAnnotation),
    );
  }, [onCodeAnnotationConsumed, pendingCodeAnnotation]);

  const editorSettings: ComposerEditorSettings = {
    preset: "default",
    expandFenceOnSpace: false,
    expandFenceOnEnter: false,
    fenceLanguageTags: false,
    fenceWrapSelection: false,
    autoWrapPasteMultiline: false,
    autoWrapPasteCodeLike: false,
    continueListOnShiftEnter: false,
  };

  return (
    <Composer
      onSend={(text, _images, options) =>
        options === undefined ? onSend(text) : onSend(text, options)
      }
      onQueue={() => {}}
      onStop={() => {}}
      canStop={false}
      isProcessing={false}
      steerEnabled={false}
      collaborationModes={[]}
      collaborationModesEnabled={true}
      selectedCollaborationModeId={null}
      onSelectCollaborationMode={() => {}}
      selectedEngine={selectedEngine}
      onSelectEngine={onSelectEngine}
      isSharedSession={Boolean(sharedTarget)}
      sharedTargetPickerLocked={sharedTargetPickerLocked}
      createSessionTargetPicker={createSessionTargetPicker}
      onCreationTargetEngineChange={onCreationTargetEngineChange}
      providerProfileId={sharedTarget?.providerProfileId ?? providerProfileId}
      models={
        sharedTarget
          ? [
              {
                id: sharedTarget.model,
                displayName: sharedTarget.model,
                model: sharedTarget.runtimeModel ?? sharedTarget.model,
              },
            ]
          : models
      }
      selectedModelId={sharedTarget?.model ?? selectedModelId}
      onSelectModel={onSelectModel}
      reasoningOptions={[]}
      selectedEffort={sharedTarget?.effort ?? null}
      onSelectEffort={() => {}}
      reasoningSupported={false}
      accessMode="current"
      onSelectAccessMode={() => {}}
      skills={[]}
      prompts={[]}
      commands={[]}
      files={[]}
      textareaRef={textareaRef}
      dictationEnabled={false}
      editorSettings={editorSettings}
      activeWorkspaceId="ws-1"
      activeThreadId={activeThreadId}
      pendingCodeAnnotation={pendingCodeAnnotation}
      onCodeAnnotationConsumed={onCodeAnnotationConsumed}
      selectedCodeAnnotations={selectedCodeAnnotations}
      onRemoveCodeAnnotation={handleRemoveCodeAnnotation}
      onClearCodeAnnotations={handleClearCodeAnnotations}
    />
  );
}

function getTextarea(container: HTMLElement) {
  const textarea = container.querySelector("textarea");
  if (!textarea) {
    throw new Error("Textarea not found");
  }
  return textarea as HTMLTextAreaElement;
}

describe("Composer file reference token", () => {
  it("routes an unsubscribed Home engine target to the account purchase flow", async () => {
    publishManagedEngineEntitlementsV1([
      {
        id: "codex",
        displayName: "Codex",
        entitlement: { status: "none", expiresAt: null },
      },
      {
        id: "claude-code",
        displayName: "Claude",
        entitlement: { status: "active", expiresAt: null },
      },
    ]);
    const switchIntent = vi.fn();
    const unsubscribe = subscribeAccountEngineSwitchV1(switchIntent);
    const onCreationTargetEngineChange = vi.fn();
    const onSelectEngine = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={vi.fn()}
        createSessionTargetPicker
        onCreationTargetEngineChange={onCreationTargetEngineChange}
        onSelectEngine={onSelectEngine}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByTestId("select-shared-target"));
      await Promise.resolve();
    });

    expect(switchIntent).toHaveBeenCalledWith({
      source: "enginePicker",
      targetEngineId: "codex",
      openNewConversation: true,
    });
    expect(onSelectEngine).not.toHaveBeenCalled();
    expect(onCreationTargetEngineChange).toHaveBeenLastCalledWith("codex");
    unsubscribe();
  });

  it("keeps the selected Codex target while managed engine preparation is pending", async () => {
    publishManagedEngineEntitlementsV1([
      {
        id: "codex",
        displayName: "Codex",
        entitlement: { status: "active", expiresAt: null },
      },
      {
        id: "claude-code",
        displayName: "Claude",
        entitlement: { status: "active", expiresAt: null },
      },
    ]);
    const onSend = vi.fn();
    const switchIntent = vi.fn();
    const unsubscribe = subscribeAccountEngineSwitchV1(switchIntent);
    const view = render(
      <ComposerHarness onSend={onSend} createSessionTargetPicker />,
    );

    await act(async () => {
      fireEvent.click(view.getByTestId("select-shared-target"));
      await Promise.resolve();
      const textarea = getTextarea(view.container);
      fireEvent.change(textarea, { target: { value: "use codex" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      await Promise.resolve();
    });

    expect(switchIntent).toHaveBeenCalledWith({
      source: "enginePicker",
      targetEngineId: "codex",
      openNewConversation: true,
    });
    expect(onSend).toHaveBeenCalledWith(
      "use codex",
      expect.objectContaining({
        createSessionTarget: expect.objectContaining({ engine: "codex" }),
      }),
    );
    unsubscribe();
  });

  it("keeps Home create-session target local and sends one complete target", async () => {
    const onSend = vi.fn();
    const onCreationTargetEngineChange = vi.fn();
    const onSelectEngine = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={onSend}
        createSessionTargetPicker
        onCreationTargetEngineChange={onCreationTargetEngineChange}
        onSelectEngine={onSelectEngine}
      />,
    );

    const authority = view.getByTestId("composer-target-authority");
    expect(authority.dataset.atomicTarget).toBe("true");
    expect(authority.dataset.pickerMode).toBe("create-session");

    await act(async () => {
      fireEvent.click(view.getByTestId("select-shared-target"));
      await Promise.resolve();
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(onCreationTargetEngineChange).toHaveBeenLastCalledWith("codex");
    // 首页切 CLI 必须同步全局 engine，重启后首页才能回到上次选择
    expect(onSelectEngine).toHaveBeenCalledWith("codex");
    // 等价 engine 不得在每次父树重渲染时重复 publish（#185 防护）
    const publishCountAfterMount =
      onCreationTargetEngineChange.mock.calls.length;
    await act(async () => {
      view.rerender(
        <ComposerHarness
          onSend={onSend}
          createSessionTargetPicker
          onCreationTargetEngineChange={onCreationTargetEngineChange}
          onSelectEngine={onSelectEngine}
          selectedEngine="codex"
        />,
      );
      await Promise.resolve();
    });
    expect(onCreationTargetEngineChange.mock.calls.length).toBe(
      publishCountAfterMount,
    );

    const textarea = getTextarea(view.container);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "home target" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      "home target",
      expect.objectContaining({
        createSessionTarget: {
          engine: "codex",
          providerProfileId: "provider-b",
          providerProfileName: "Provider B",
          providerProfileSource: "managed",
          modelCatalogEntryId: "settings-reasoning",
          model: "deepseek-v4-pro",
          effort: "high",
        },
      }),
    );
  });

  it("sends a prepared Codex subscription through the managed provider", async () => {
    publishManagedEngineEntitlementsV1([
      {
        id: "codex",
        displayName: "Codex",
        entitlement: { status: "active", expiresAt: null },
      },
      {
        id: "claude-code",
        displayName: "Claude",
        entitlement: { status: "none", expiresAt: null },
      },
    ]);
    markManagedEnginePreparedV1("codex");
    const onSend = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={onSend}
        createSessionTargetPicker
        selectedEngine="codex"
        activeThreadId={null}
        selectedModelId="matrix-codex"
        models={[
          {
            id: "matrix-codex",
            displayName: "GPT-5.5 Codex",
            model: "gpt-5.5-codex",
            providerProfileId: "doge-token-matrix",
          },
        ]}
      />,
    );

    expect(getTextarea(view.container).dataset.providerProfileId).toBe(
      "doge-token-matrix",
    );
    await act(async () => {
      const textarea = getTextarea(view.container);
      fireEvent.change(textarea, { target: { value: "managed target" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      "managed target",
      expect.objectContaining({
        createSessionTarget: expect.objectContaining({
          engine: "codex",
          providerProfileId: "doge-token-matrix",
          modelCatalogEntryId: "matrix-codex",
          model: "gpt-5.5-codex",
        }),
      }),
    );
  });

  it("binds a product-ready Kimi Home send to the managed provider contract", async () => {
    publishProductReadyV1({
      entitlement: {
        status: "active",
        subscriptionId: 9,
        groupId: 5,
        groupName: "Doge",
        planName: "Doge subscription",
        expiresAt: "2030-02-01T00:00:00Z",
        usage: null,
      },
      engines: [
        { id: "codex", displayName: "Codex" },
        { id: "claude-code", displayName: "Claude" },
        { id: "kimi", displayName: "Kimi CLI" },
      ],
      models: [
        {
          id: "gpt-5.5",
          displayName: "gpt-5.5",
          model: "gpt-5.5",
          apiProtocols: ["openai-responses", "openai-chat-completions"],
          capabilities: ["chat"],
        },
        {
          id: "kimi-for-coding",
          displayName: "Kimi for Coding",
          model: "kimi-for-coding",
          apiProtocols: ["openai-chat-completions"],
          capabilities: ["chat"],
        },
      ],
    });
    const onSend = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={onSend}
        createSessionTargetPicker
        selectedEngine="kimi"
        activeThreadId={null}
        selectedModelId="gpt-5.5"
      />,
    );

    expect(getTextarea(view.container).dataset.providerProfileId).toBe(
      "doge-token-matrix",
    );
    expect(view.getByTestId("composer-target-authority").dataset).toMatchObject(
      {
        pickerMode: "product",
        productEngines: "3",
        productModels: "2",
        readinessEngine: "codex",
        readinessModel: "gpt-5.5",
      },
    );
    await act(async () => {
      fireEvent.click(view.getByTestId("select-product-kimi-model"));
      await Promise.resolve();
      expect(
        view.getByTestId("composer-target-authority").dataset,
      ).toMatchObject({
        readinessEngine: "kimi",
        readinessModel: "Kimi for Coding",
      });
      const textarea = getTextarea(view.container);
      fireEvent.change(textarea, { target: { value: "product Kimi target" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      "product Kimi target",
      expect.objectContaining({
        createSessionTarget: expect.objectContaining({
          engine: "kimi",
          providerProfileId: "doge-token-matrix",
          providerProfileSource: "managed",
          modelCatalogEntryId: "kimi-code/kimi-for-coding",
          model: "kimi-for-coding",
        }),
      }),
    );
  });

  it("uses the three-engine managed product picker while modifying a native conversation", () => {
    publishProductReadyV1({
      entitlement: {
        status: "active",
        subscriptionId: 9,
        groupId: 5,
        groupName: "Doge",
        planName: "Doge subscription",
        expiresAt: "2030-02-01T00:00:00Z",
        usage: null,
      },
      engines: [
        { id: "codex", displayName: "Codex" },
        { id: "claude-code", displayName: "Claude" },
        { id: "kimi", displayName: "Kimi CLI" },
      ],
      models: [
        {
          id: "gpt-5.5",
          displayName: "GPT-5.5",
          model: "gpt-5.5",
          apiProtocols: ["openai-responses", "openai-chat-completions"],
          capabilities: ["chat"],
        },
        {
          id: "kimi-for-coding",
          displayName: "Kimi for Coding",
          model: "kimi-for-coding",
          apiProtocols: ["openai-chat-completions"],
          capabilities: ["chat"],
        },
      ],
    });

    const view = render(
      <ComposerHarness
        onSend={() => {}}
        selectedEngine="codex"
        selectedModelId="gpt-5.5"
        providerProfileId="doge-token-matrix"
      />,
    );

    expect(view.getByTestId("composer-target-authority").dataset).toMatchObject({
      pickerMode: "product",
      productEngines: "3",
      productModels: "2",
    });
    expect(getTextarea(view.container).dataset.providerProfileId).toBe(
      "doge-token-matrix",
    );
  });

  it("persists the Composite public alias when Native Kimi selects Doubao", () => {
    publishProductReadyV1({
      entitlement: {
        status: "active",
        subscriptionId: 9,
        groupId: 5,
        groupName: "Doge",
        planName: "Doge subscription",
        expiresAt: "2030-02-01T00:00:00Z",
        usage: null,
      },
      engines: [
        { id: "codex", displayName: "Codex" },
        { id: "claude-code", displayName: "Claude" },
        { id: "kimi", displayName: "Kimi CLI" },
      ],
      models: [{
        id: "豆包",
        displayName: "豆包",
        model: "豆包",
        apiProtocols: [
          "openai-responses",
          "openai-chat-completions",
          "anthropic-messages",
        ],
        capabilities: ["chat"],
      }],
    });
    const onSelectModel = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        onSelectModel={onSelectModel}
        selectedEngine="kimi"
        selectedModelId="gpt-5.5"
        providerProfileId="doge-token-matrix"
      />,
    );

    fireEvent.click(view.getByTestId("select-product-doubao-model"));

    expect(onSelectModel).toHaveBeenCalledWith("豆包");
    expect(view.getByTestId("composer-target-authority").dataset).toMatchObject({
      pickerMode: "product",
      readinessEngine: "kimi",
      readinessModel: "豆包",
    });
  });

  it("automatically prepares an active Home subscription before using a local fallback", () => {
    publishManagedEngineEntitlementsV1([
      {
        id: "codex",
        displayName: "Codex",
        entitlement: { status: "active", expiresAt: null },
      },
      {
        id: "claude-code",
        displayName: "Claude",
        entitlement: { status: "active", expiresAt: null },
      },
    ]);
    markManagedEnginePreparedV1("claude-code");
    const switchIntent = vi.fn();
    const unsubscribe = subscribeAccountEngineSwitchV1(switchIntent);

    render(
      <ComposerHarness
        onSend={vi.fn()}
        createSessionTargetPicker
        selectedEngine="codex"
        activeThreadId={null}
      />,
    );

    expect(switchIntent).toHaveBeenCalledTimes(1);
    expect(switchIntent).toHaveBeenCalledWith({
      source: "enginePicker",
      targetEngineId: "codex",
      openNewConversation: true,
    });
    unsubscribe();
  });

  it("blocks a prepared managed default until its scoped catalog resolves", async () => {
    publishManagedEngineEntitlementsV1([
      {
        id: "codex",
        displayName: "Codex",
        entitlement: { status: "active", expiresAt: null },
      },
      {
        id: "claude-code",
        displayName: "Claude",
        entitlement: { status: "none", expiresAt: null },
      },
    ]);
    markManagedEnginePreparedV1("codex");
    const onSend = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={onSend}
        createSessionTargetPicker
        selectedEngine="codex"
        activeThreadId={null}
      />,
    );

    await act(async () => {
      const textarea = getTextarea(view.container);
      fireEvent.change(textarea, { target: { value: "must not fall back" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      await Promise.resolve();
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps an explicit local target usable while the managed catalog is pending", async () => {
    publishManagedEngineEntitlementsV1([
      {
        id: "codex",
        displayName: "Codex",
        entitlement: { status: "active", expiresAt: null },
      },
      {
        id: "claude-code",
        displayName: "Claude",
        entitlement: { status: "none", expiresAt: null },
      },
    ]);
    markManagedEnginePreparedV1("codex");
    const onSend = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={onSend}
        createSessionTargetPicker
        selectedEngine="codex"
        activeThreadId={null}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByTestId("select-codex-local-target"));
      await Promise.resolve();
    });
    await act(async () => {
      const textarea = getTextarea(view.container);
      fireEvent.change(textarea, { target: { value: "explicit local" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      "explicit local",
      expect.objectContaining({
        createSessionTarget: expect.objectContaining({
          engine: "codex",
          providerProfileId: null,
          providerProfileSource: "disk",
        }),
      }),
    );
  });

  it("resets an explicit local creation target before the next managed session", async () => {
    publishManagedEngineEntitlementsV1([
      {
        id: "codex",
        displayName: "Codex",
        entitlement: { status: "active", expiresAt: null },
      },
      {
        id: "claude-code",
        displayName: "Claude",
        entitlement: { status: "none", expiresAt: null },
      },
    ]);
    markManagedEnginePreparedV1("codex");
    const onSend = vi.fn();
    const managedModels = [
      {
        id: "matrix-codex",
        displayName: "GPT-5.5 Codex",
        model: "gpt-5.5-codex",
        providerProfileId: "doge-token-matrix",
      },
    ];
    const view = render(
      <ComposerHarness
        onSend={onSend}
        createSessionTargetPicker
        selectedEngine="codex"
        activeThreadId={null}
        selectedModelId="matrix-codex"
        models={managedModels}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByTestId("select-codex-local-target"));
      await Promise.resolve();
    });
    expect(getTextarea(view.container).dataset.providerProfileId).toBe("null");

    await act(async () => {
      view.rerender(
        <ComposerHarness
          onSend={onSend}
          selectedEngine="codex"
          activeThreadId="codex:local-session"
          providerProfileId={null}
        />,
      );
      await Promise.resolve();
    });
    expect(getTextarea(view.container).dataset.providerProfileId).toBe("null");

    await act(async () => {
      view.rerender(
        <ComposerHarness
          onSend={onSend}
          createSessionTargetPicker
          selectedEngine="codex"
          activeThreadId={null}
          selectedModelId="matrix-codex"
          models={managedModels}
        />,
      );
      await Promise.resolve();
    });

    expect(getTextarea(view.container).dataset.providerProfileId).toBe(
      "doge-token-matrix",
    );
  });

  it("drops sticky home creation engine when selectedEngine restores externally", async () => {
    const onSend = vi.fn();
    const onCreationTargetEngineChange = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={onSend}
        createSessionTargetPicker
        onCreationTargetEngineChange={onCreationTargetEngineChange}
        selectedEngine="claude"
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByTestId("select-shared-target"));
      await Promise.resolve();
    });
    expect(onCreationTargetEngineChange).toHaveBeenLastCalledWith("codex");

    // 模拟启动 restore 把全局 engine 切到 grok（非本 picker 触发）
    await act(async () => {
      view.rerender(
        <ComposerHarness
          onSend={onSend}
          createSessionTargetPicker
          onCreationTargetEngineChange={onCreationTargetEngineChange}
          selectedEngine="grok"
        />,
      );
      await Promise.resolve();
    });

    // sticky codex 应被清掉，首页跟随 restore 后的 grok
    expect(onCreationTargetEngineChange).toHaveBeenLastCalledWith("grok");
  });

  it("accepts a Claude local model as the Home creation target", async () => {
    const onSend = vi.fn();
    const view = render(
      <ComposerHarness onSend={onSend} createSessionTargetPicker />,
    );

    await act(async () => {
      fireEvent.click(view.getByTestId("select-claude-local-target"));
      await Promise.resolve();
    });

    const textarea = getTextarea(view.container);
    expect(textarea.dataset.providerProfileId).toBe("null");

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "local target" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      "local target",
      expect.objectContaining({
        createSessionTarget: {
          engine: "claude",
          providerProfileId: null,
          providerProfileName: "本地配置",
          providerProfileSource: "disk",
          modelCatalogEntryId: "settings-main",
          model: "kimi-for-coding",
          effort: null,
        },
      }),
    );
  });

  it("does not fabricate a Shared target from global Composer props", () => {
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        sharedTarget={{
          providerProfileId: "openrouter",
          model: "claude-sonnet-4-5",
          runtimeModel: "claude-sonnet-4-5-runtime",
          effort: "high",
        }}
      />,
    );

    expect(
      getSharedTargetState("ws-1", "thread-1").selectedNextTarget,
    ).toBeNull();
    const authority = view.getByTestId("composer-target-authority");
    expect(authority.dataset.atomicTarget).toBe("true");
    expect(authority.dataset.pickerMode).toBe("shared");
  });

  it("keeps explicit local Provider and empty reasoning instead of old props", () => {
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        sharedTarget={{
          providerProfileId: "openrouter",
          model: "claude-sonnet-4-5",
          effort: "high",
        }}
      />,
    );

    act(() => {
      selectNextTarget("ws-1", "thread-1", {
        engine: "claude",
        providerProfileId: null,
        modelCatalogEntryId: "claude-opus-4-1",
        model: "claude-opus-4-1",
        reasoning: null,
        providerProfileNameSnapshot: "本地配置",
        providerProfileSource: "disk",
      });
    });

    const textarea = getTextarea(view.container);
    expect(textarea.dataset.providerProfileId).toBe("null");
    expect(textarea.dataset.effort).toBe("null");
  });

  it("persists every Shared picker level without provisioning a binding", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      selectedTarget: {
        engine: "codex",
        providerProfileId: "provider-b",
        modelCatalogEntryId: "settings-reasoning",
        model: "deepseek-v4-pro",
        reasoning: { effort: "high" },
        providerProfileNameSnapshot: "Provider B",
        providerProfileSource: "managed",
      },
    });
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        sharedTarget={{
          providerProfileId: "openrouter",
          model: "claude-sonnet-4-5",
          effort: "high",
        }}
      />,
    );

    fireEvent.click(view.getByTestId("select-shared-target"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "set_shared_session_selected_engine",
        {
          workspaceId: "ws-1",
          threadId: "thread-1",
          selectedEngine: "codex",
          providerProfileId: "provider-b",
          modelCatalogEntryId: "settings-reasoning",
          model: "deepseek-v4-pro",
          reasoningEffort: "high",
          providerProfileNameSnapshot: "Provider B",
          providerProfileSource: "managed",
        },
      );
    });
    expect(getSharedTargetState("ws-1", "thread-1").selectedNextTarget).toEqual(
      {
        engine: "codex",
        providerProfileId: "provider-b",
        modelCatalogEntryId: "settings-reasoning",
        model: "deepseek-v4-pro",
        reasoning: { effort: "high" },
        providerProfileNameSnapshot: "Provider B",
        providerProfileSource: "managed",
      },
    );
  });

  it("automatically repairs a product-ready Shared selection to a released managed target", async () => {
    publishProductReadyV1({
      entitlement: {
        status: "active",
        subscriptionId: 9,
        groupId: 5,
        groupName: "Doge",
        planName: "Doge subscription",
        expiresAt: "2030-02-01T00:00:00Z",
        usage: null,
      },
      engines: [
        { id: "codex", displayName: "Codex" },
        { id: "claude-code", displayName: "Claude" },
        { id: "kimi", displayName: "Kimi CLI" },
      ],
      models: [
        {
          id: "gpt-5.6-sol",
          displayName: "GPT-5.6 Sol",
          model: "gpt-5.6-sol",
          apiProtocols: ["openai-responses", "openai-chat-completions"],
          capabilities: ["chat"],
        },
        {
          id: "kimi-for-coding",
          displayName: "Kimi for Coding",
          model: "kimi-for-coding",
          apiProtocols: ["openai-chat-completions"],
          capabilities: ["chat"],
        },
      ],
    });
    selectNextTarget("ws-1", "thread-1", {
      engine: "codex",
      providerProfileId: null,
      modelCatalogEntryId: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
    });
    const persistedTarget = {
      engine: "codex",
      providerProfileId: "doge-token-matrix",
      modelCatalogEntryId: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      reasoning: null,
      providerProfileNameSnapshot: "Doge",
      providerProfileSource: "managed",
    };
    vi.mocked(invoke).mockResolvedValueOnce({
      selectedTarget: persistedTarget,
    });
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        sharedTarget={{
          providerProfileId: "local",
          model: "gpt-5.6-sol",
          effort: "low",
        }}
      />,
    );

    expect(view.getByTestId("composer-target-authority").dataset).toMatchObject(
      {
        pickerMode: "product",
        productEngines: "3",
        productModels: "2",
      },
    );
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "set_shared_session_selected_engine",
        {
          workspaceId: "ws-1",
          threadId: "thread-1",
          selectedEngine: "codex",
          providerProfileId: "doge-token-matrix",
          modelCatalogEntryId: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          reasoningEffort: null,
          providerProfileNameSnapshot: "Doge",
          providerProfileSource: "managed",
        },
      );
    });
    expect(getSharedTargetState("ws-1", "thread-1").selectedNextTarget).toEqual(
      {
        ...persistedTarget,
        reasoning: { effort: "low" },
      },
    );
  });

  it("keeps Shared CLI navigation transitional until a complete Model target exists", () => {
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        sharedTarget={{
          providerProfileId: "openrouter",
          model: "claude-sonnet-4-5",
          effort: "high",
        }}
      />,
    );

    fireEvent.click(view.getByTestId("navigate-shared-cli"));

    expect(invoke).not.toHaveBeenCalled();
    expect(pushErrorToast).not.toHaveBeenCalled();
  });

  it("does not serialize target persistence across parallel Shared sessions", async () => {
    let releaseFirstPersistence: (() => void) | undefined;
    const firstPersistence = new Promise<null>((resolve) => {
      releaseFirstPersistence = () => resolve(null);
    });
    vi.mocked(invoke)
      .mockImplementationOnce(() => firstPersistence)
      .mockResolvedValueOnce(null);
    const sharedTarget = {
      providerProfileId: "openrouter",
      model: "claude-sonnet-4-5",
      effort: "high",
    };
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        activeThreadId="shared-a"
        sharedTarget={sharedTarget}
      />,
    );

    fireEvent.click(view.getByTestId("select-shared-target"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    view.rerender(
      <ComposerHarness
        onSend={() => {}}
        activeThreadId="shared-b"
        sharedTarget={sharedTarget}
      />,
    );
    fireEvent.click(view.getByTestId("select-shared-target"));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(vi.mocked(invoke).mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ threadId: "shared-b" }),
    );
    releaseFirstPersistence?.();
  });

  it("does not persist reasoning changes from a legacy partial Shared target", () => {
    selectNextTarget("ws-1", "thread-1", {
      engine: "codex",
      providerProfileId: "legacy-provider",
      modelCatalogEntryId: null,
      model: null,
      reasoning: null,
      providerProfileNameSnapshot: null,
      providerProfileSource: null,
    });
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        sharedTarget={{
          providerProfileId: "legacy-provider",
          model: "legacy-model",
          effort: "low",
        }}
      />,
    );

    fireEvent.click(view.getByTestId("select-shared-effort"));

    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the last persisted target when the next picker persistence fails", async () => {
    const previousTarget = {
      engine: "claude" as const,
      providerProfileId: null,
      modelCatalogEntryId: "claude-opus-4-1",
      model: "claude-opus-4-1",
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk" as const,
    };
    selectNextTarget("ws-1", "thread-1", previousTarget);
    dispatchSharedSendEvent("ws-1", "thread-1", { type: "send" });
    dispatchSharedSendEvent(
      "ws-1",
      "thread-1",
      { type: "targetUnavailable" },
      { detail: "provider removed" },
    );
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk unavailable"));
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        sharedTarget={{
          providerProfileId: "openrouter",
          model: "claude-sonnet-4-5",
          effort: "high",
        }}
      />,
    );

    fireEvent.click(view.getByTestId("select-shared-target"));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(
        getSharedTargetState("ws-1", "thread-1").selectedNextTarget,
      ).toEqual(previousTarget);
    });
    expect(getSharedSendState("ws-1", "thread-1")).toEqual({
      state: "target-unavailable",
      degradedInfo: null,
      detail: "provider removed",
    });
    // 仍停在同一会话的真失败：继续提示
    expect(pushErrorToast).toHaveBeenCalled();
  });

  it("does not toast when shared target meta is missing (ENOENT)", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error("No such file or directory (os error 2)"),
    );
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        sharedTarget={{
          providerProfileId: "openrouter",
          model: "claude-sonnet-4-5",
          effort: "high",
        }}
      />,
    );

    fireEvent.click(view.getByTestId("select-shared-target"));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      // 静默回滚完成（无 previous 时 selected 可为空）
      expect(invoke).toHaveBeenCalled();
    });
    expect(pushErrorToast).not.toHaveBeenCalled();
  });

  it("does not toast when target persist fails after the user left the session", async () => {
    let releaseFirst!: (error: Error) => void;
    const firstPersistence = new Promise<null>((_resolve, reject) => {
      releaseFirst = reject;
    });
    vi.mocked(invoke).mockImplementationOnce(() => firstPersistence);

    const sharedTarget = {
      providerProfileId: "openrouter",
      model: "claude-sonnet-4-5",
      effort: "high",
    };
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        activeThreadId="shared-a"
        sharedTarget={sharedTarget}
      />,
    );

    fireEvent.click(view.getByTestId("select-shared-target"));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    // 用户切到另一会话后，旧会话 persist 才失败
    view.rerender(
      <ComposerHarness
        onSend={() => {}}
        activeThreadId="shared-b"
        sharedTarget={sharedTarget}
      />,
    );
    await act(async () => {
      releaseFirst(new Error("disk unavailable"));
    });

    await waitFor(() => {
      expect(
        getSharedTargetState("ws-1", "shared-a").selectedNextTarget,
      ).not.toEqual(
        expect.objectContaining({
          model: "deepseek-v4-pro",
        }),
      );
    });
    expect(pushErrorToast).not.toHaveBeenCalled();
  });

  it("repairs target-unavailable only after backend confirms the exact target", async () => {
    dispatchSharedSendEvent("ws-1", "thread-1", { type: "send" });
    dispatchSharedSendEvent(
      "ws-1",
      "thread-1",
      { type: "targetUnavailable" },
      { detail: "provider removed" },
    );
    vi.mocked(invoke).mockResolvedValueOnce({
      selectedTarget: {
        engine: "codex",
        providerProfileId: "provider-b",
        modelCatalogEntryId: "settings-reasoning",
        model: "deepseek-v4-pro",
        reasoning: { effort: "high" },
        providerProfileNameSnapshot: "Provider B",
        providerProfileSource: "managed",
      },
    });
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        sharedTarget={{
          providerProfileId: "openrouter",
          model: "claude-sonnet-4-5",
          effort: "high",
        }}
      />,
    );

    fireEvent.click(view.getByTestId("select-shared-target"));

    await waitFor(() => {
      expect(getSharedSendState("ws-1", "thread-1")).toEqual({
        state: "idle",
        degradedInfo: null,
        detail: null,
      });
    });
  });

  it("keeps target-unavailable locked when backend confirms a different target", async () => {
    const previousTarget = {
      engine: "claude" as const,
      providerProfileId: null,
      modelCatalogEntryId: "claude-opus-4-1",
      model: "claude-opus-4-1",
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk" as const,
    };
    selectNextTarget("ws-1", "thread-1", previousTarget);
    dispatchSharedSendEvent("ws-1", "thread-1", { type: "send" });
    dispatchSharedSendEvent(
      "ws-1",
      "thread-1",
      { type: "targetUnavailable" },
      { detail: "provider removed" },
    );
    vi.mocked(invoke).mockResolvedValueOnce({
      selectedTarget: {
        engine: "codex",
        providerProfileId: "provider-c",
        modelCatalogEntryId: "settings-reasoning",
        model: "deepseek-v4-pro",
        reasoning: { effort: "high" },
        providerProfileNameSnapshot: "Provider C",
        providerProfileSource: "managed",
      },
    });
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        sharedTarget={{
          providerProfileId: "openrouter",
          model: "claude-sonnet-4-5",
          effort: "high",
        }}
      />,
    );

    fireEvent.click(view.getByTestId("select-shared-target"));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(
        getSharedTargetState("ws-1", "thread-1").selectedNextTarget,
      ).toEqual(previousTarget);
    });
    expect(getSharedSendState("ws-1", "thread-1")).toEqual({
      state: "target-unavailable",
      degradedInfo: null,
      detail: "provider removed",
    });
  });

  it("publishes the selected native Provider and Model as a continuation request", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProviderContinuationDialogRequests(listener);
    const view = render(<ComposerHarness onSend={() => {}} />);

    fireEvent.click(view.getByTestId("request-provider-continuation"));

    expect(listener).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      sourceSessionId: "thread-1",
      destination: {
        engine: "codex",
        providerProfileId: "provider-b",
        modelCatalogEntryId: "settings-reasoning",
        model: "deepseek-v4-pro",
        reasoningEffort: null,
        providerProfileNameSnapshot: "Provider B",
        providerProfileSource: "managed",
        runtimeCapabilityFingerprint: null,
      },
    });
    unsubscribe();
  });

  it("updates a Claude continuation model in place for the same Doge binding", () => {
    const continuation = vi.fn();
    const unsubscribe = subscribeProviderContinuationDialogRequests(continuation);
    const onSelectModel = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        selectedEngine="claude"
        providerProfileId="doge-token-matrix"
        selectedModelId="claude-sonnet-4-8"
        models={[
          {
            id: "claude-sonnet-4-8",
            displayName: "Claude Sonnet 4.8",
            model: "claude-sonnet-4-8",
            providerProfileId: "doge-token-matrix",
          },
          {
            id: "claude-opus-4-8",
            displayName: "Claude Opus 4.8",
            model: "claude-opus-4-8",
            providerProfileId: "doge-token-matrix",
          },
        ]}
        onSelectModel={onSelectModel}
      />,
    );

    fireEvent.click(view.getByTestId("select-claude-token-matrix-target"));

    expect(onSelectModel).toHaveBeenCalledWith("claude-opus-4-8");
    expect(continuation).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("revalidates a same-engine Token Matrix credential before creating a continuation", () => {
    publishManagedEngineEntitlementsV1([
      {
        id: "codex",
        displayName: "Codex",
        entitlement: { status: "active", expiresAt: null },
      },
      {
        id: "claude-code",
        displayName: "Claude",
        entitlement: { status: "none", expiresAt: null },
      },
    ]);
    // Renderer readiness can be stale when the OS vault entry disappears.
    markManagedEnginePreparedV1("codex");
    const switchIntent = vi.fn();
    const continuation = vi.fn();
    const unsubscribeSwitch = subscribeAccountEngineSwitchV1(switchIntent);
    const unsubscribeContinuation =
      subscribeProviderContinuationDialogRequests(continuation);
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        selectedEngine="codex"
        providerProfileId={null}
      />,
    );

    fireEvent.click(view.getByTestId("select-codex-token-matrix-target"));

    expect(switchIntent).toHaveBeenCalledWith({
      source: "enginePicker",
      targetEngineId: "codex",
      openNewConversation: true,
    });
    expect(continuation).not.toHaveBeenCalled();
    unsubscribeContinuation();
    unsubscribeSwitch();
  });

  // fix-shared-session-identity-id-first：isSharedSession prop 退化（false）+
  // shared: id 时，picker 仍 MUST 走 Shared 持久化，MUST NOT 发续接请求。
  it("routes target changes to shared persistence and never emits continuation when identity projection is lost", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProviderContinuationDialogRequests(listener);
    vi.mocked(invoke).mockResolvedValueOnce({ selectedTarget: null });
    const view = render(
      <ComposerHarness onSend={() => {}} activeThreadId="shared:degraded" />,
    );

    const authority = view.getByTestId("composer-target-authority");
    expect(authority.dataset.pickerMode).toBe("shared");

    fireEvent.click(view.getByTestId("request-provider-continuation"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "set_shared_session_selected_engine",
        expect.objectContaining({
          workspaceId: "ws-1",
          threadId: "shared:degraded",
        }),
      );
    });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  // locked 不构成身份防线：locked + 投影丢失时点选为 no-op，仍不续接。
  it("keeps locked shared picker inert when identity projection is lost", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProviderContinuationDialogRequests(listener);
    const view = render(
      <ComposerHarness
        onSend={() => {}}
        activeThreadId="shared:locked"
        sharedTargetPickerLocked
      />,
    );

    fireEvent.click(view.getByTestId("request-provider-continuation"));

    expect(listener).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("converts visual file tokens to absolute paths before send", async () => {
    const onSend = vi.fn();
    const view = render(<ComposerHarness onSend={onSend} />);
    const textarea = getTextarea(view.container);

    const value =
      "请检查 📁 src-tauri `/Users/demo/repo/src-tauri` 和 📄 App.tsx `/Users/demo/repo/src/App.tsx`";

    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value,
          selectionStart: value.length,
        },
      });
      textarea.focus();
      textarea.setSelectionRange(value.length, value.length);
      fireEvent.select(textarea);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(textarea.value).toBe("请检查 📁 src-tauri 和 📄 App.tsx");

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", bubbles: true });
    });

    expect(onSend).toHaveBeenCalledWith(
      "请检查 /Users/demo/repo/src-tauri 和 /Users/demo/repo/src/App.tsx",
    );
  });

  it("does not hit maximum update depth when file tokens settle under repeated parent rerenders", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onSend = vi.fn();
    const view = render(<ComposerHarness onSend={onSend} />);
    const textarea = getTextarea(view.container);
    const value = "请检查 📄 App.tsx `/Users/demo/repo/src/App.tsx`";

    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value,
          selectionStart: value.length,
        },
      });
      fireEvent.select(textarea);
    });

    // 模拟 AppShell / ActiveCanvas 高频父渲染：token 已 settle 后仍不得 #185
    for (let i = 0; i < 20; i += 1) {
      await act(async () => {
        view.rerender(<ComposerHarness onSend={onSend} />);
        await Promise.resolve();
      });
    }

    expect(getTextarea(view.container).value).toBe("请检查 📄 App.tsx");
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Minified React error #185"),
    );
    consoleErrorSpy.mockRestore();
  });

  it("does not hit maximum update depth when skills/commands identity thrash after token settle", async () => {
    // C-20260804-02：0.7.16 App-DjQ3UnSh 生产栈落在 Composer extract effect。
    // 父树每次渲染换 skills/commands 数组引用时，旧 effect deps 会反复入场。
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onSend = vi.fn();
    const onDraftChange = vi.fn();

    function ThrashingSkillsHarness() {
      const [tick, setTick] = useState(0);
      // 每次 tick 新数组引用，语义相同
      void tick;
      return (
        <div>
          <button
            type="button"
            data-testid="thrash-skills"
            onClick={() => setTick((n) => n + 1)}
          >
            thrash
          </button>
          <Composer
            onSend={(text) => onSend(text)}
            onQueue={() => {}}
            onStop={() => {}}
            canStop={false}
            isProcessing={false}
            steerEnabled={false}
            collaborationModes={[]}
            collaborationModesEnabled
            selectedCollaborationModeId={null}
            onSelectCollaborationMode={() => {}}
            selectedEngine="claude"
            models={[]}
            selectedModelId={null}
            onSelectModel={() => {}}
            reasoningOptions={[]}
            selectedEffort={null}
            onSelectEffort={() => {}}
            reasoningSupported={false}
            accessMode="current"
            onSelectAccessMode={() => {}}
            skills={[
              {
                name: "review-pr",
                path: "/tmp/review-pr",
                description: "review",
              },
            ]}
            prompts={[]}
            commands={[
              {
                name: "compact",
                path: "/tmp/compact",
                description: "compact",
                content: "compact",
              },
            ]}
            files={[]}
            onDraftChange={onDraftChange}
            editorSettings={{
              preset: "default",
              expandFenceOnSpace: false,
              expandFenceOnEnter: false,
              fenceLanguageTags: false,
              fenceWrapSelection: false,
              autoWrapPasteMultiline: false,
              autoWrapPasteCodeLike: false,
              continueListOnShiftEnter: false,
            }}
            activeWorkspaceId="ws-1"
            activeThreadId="thread-thrash"
          />
        </div>
      );
    }

    const view = render(<ThrashingSkillsHarness />);
    const textarea = getTextarea(view.container);
    const value = "请检查 📄 App.tsx `/Users/demo/repo/src/App.tsx` /review-pr";

    await act(async () => {
      fireEvent.change(textarea, {
        target: { value, selectionStart: value.length },
      });
      fireEvent.select(textarea);
    });

    for (let i = 0; i < 40; i += 1) {
      await act(async () => {
        fireEvent.click(view.getByTestId("thrash-skills"));
        await Promise.resolve();
      });
    }

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Minified React error #185"),
    );
    // token settle 后正文应收敛（文件标签保留；skill token 抽出）
    expect(getTextarea(view.container).value).toContain("📄 App.tsx");
    consoleErrorSpy.mockRestore();
  });

  it("deduplicates repeated references for the same path", async () => {
    const onSend = vi.fn();
    const view = render(<ComposerHarness onSend={onSend} />);
    const textarea = getTextarea(view.container);

    const value =
      "📁 ai-reach `/Users/demo/repo/ai-reach`  📁 ai-reach `/Users/demo/repo/ai-reach`";

    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value,
          selectionStart: value.length,
        },
      });
      textarea.focus();
      textarea.setSelectionRange(value.length, value.length);
      fireEvent.select(textarea);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(textarea.value).toBe("📁 ai-reach  ");

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", bubbles: true });
    });

    expect(onSend).toHaveBeenCalledWith("/Users/demo/repo/ai-reach");
  });

  it("keeps existing visible reference when duplicate token is appended", async () => {
    const onSend = vi.fn();
    const view = render(<ComposerHarness onSend={onSend} />);
    const textarea = getTextarea(view.container);

    const value = "📁 ai-reach  📁 ai-reach `/Users/demo/repo/ai-reach`  ";

    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value,
          selectionStart: value.length,
        },
      });
      textarea.focus();
      textarea.setSelectionRange(value.length, value.length);
      fireEvent.select(textarea);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(textarea.value).toBe("📁 ai-reach  ");
  });

  it("keeps one visible label when stale duplicate tokens re-enter text", async () => {
    const onSend = vi.fn();
    const view = render(<ComposerHarness onSend={onSend} />);
    const textarea = getTextarea(view.container);

    const singleToken = "📁 ai-reach `/Users/demo/repo/ai-reach`  ";
    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value: singleToken,
          selectionStart: singleToken.length,
        },
      });
      textarea.focus();
      textarea.setSelectionRange(singleToken.length, singleToken.length);
      fireEvent.select(textarea);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(textarea.value).toBe("📁 ai-reach  ");

    const staleDuplicatedTokens =
      "📁 ai-reach `/Users/demo/repo/ai-reach`  📁 ai-reach `/Users/demo/repo/ai-reach`  ";
    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value: staleDuplicatedTokens,
          selectionStart: staleDuplicatedTokens.length,
        },
      });
      textarea.focus();
      textarea.setSelectionRange(
        staleDuplicatedTokens.length,
        staleDuplicatedTokens.length,
      );
      fireEvent.select(textarea);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(textarea.value).toBe("📁 ai-reach  ");

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", bubbles: true });
    });

    expect(onSend).toHaveBeenCalledWith("/Users/demo/repo/ai-reach");
  });

  it("appends code annotations to the sent prompt", async () => {
    const onSend = vi.fn();
    const onCodeAnnotationConsumed = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={onSend}
        onCodeAnnotationConsumed={onCodeAnnotationConsumed}
        pendingCodeAnnotation={{
          path: "src/App.tsx",
          lineRange: { startLine: 12, endLine: 18 },
          body: "这里需要解释状态为什么丢失",
          source: "file-edit-mode",
        }}
      />,
    );
    const textarea = getTextarea(view.container);

    await act(async () => {
      await Promise.resolve();
    });

    expect(view.getByText("App.tsx · L12-L18")).toBeTruthy();
    expect(view.getByText("这里需要解释状态为什么丢失")).toBeTruthy();
    expect(onCodeAnnotationConsumed).toHaveBeenCalledWith(
      "src/App.tsx::12::18::这里需要解释状态为什么丢失",
    );

    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value: "请检查",
          selectionStart: 3,
        },
      });
      fireEvent.keyDown(textarea, { key: "Enter", bubbles: true });
    });

    expect(onSend).toHaveBeenCalledWith(
      "请检查\n\n@file `src/App.tsx#L12-L18`\n标注：这里需要解释状态为什么丢失",
    );
  });
});
