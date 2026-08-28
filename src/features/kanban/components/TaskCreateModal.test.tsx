/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineStatus, ModelOption } from "../../../types";
import { generateThreadTitle } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { KanbanTask } from "../types";
import { projectProductTargetCatalogV1 } from "../../account/runtime/productTargetCatalog";
import { clearTaskDraft, saveTaskDraft } from "../utils/kanbanStorage";
import { TaskCreateModal } from "./TaskCreateModal";

vi.mock("../../../services/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../services/tauri")>(
    "../../../services/tauri",
  );
  return {
    ...actual,
    pickImageFiles: vi.fn().mockResolvedValue([]),
    generateThreadTitle: vi.fn(),
  };
});

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

const engineStatuses: EngineStatus[] = [
  {
    engineType: "claude",
    installed: true,
    version: "1.0.0",
    binPath: "/usr/local/bin/claude",
    features: {
      streaming: true,
      reasoning: true,
      toolUse: true,
      imageInput: true,
      sessionContinuation: true,
    },
    models: [
      {
        id: "claude-sonnet",
        displayName: "Claude Sonnet",
        description: "Default model",
        isDefault: true,
      },
    ],
    error: null,
  },
];

const emptyCodexModels: ModelOption[] = [];

const sharedCodexModels: ModelOption[] = [
  {
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    description: "Latest Codex model",
    source: "catalog",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: true,
  },
  {
    id: "gpt-5.4",
    model: "gpt-5.4",
    displayName: "GPT-5.4",
    description: "Codex model",
    source: "runtime",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: false,
  },
];

const engineStatusesWithLegacyCodexModels: EngineStatus[] = [
  ...engineStatuses,
  {
    engineType: "codex",
    installed: true,
    version: "1.0.0",
    binPath: "/usr/local/bin/codex",
    features: {
      streaming: true,
      reasoning: true,
      toolUse: true,
      imageInput: true,
      sessionContinuation: true,
    },
    models: [
      {
        id: "gpt-5.1-codex-max",
        displayName: "GPT-5.1 Codex Max",
        description: "Legacy fallback model",
        isDefault: true,
      },
    ],
    error: null,
  },
];

function findSelectWithOption(
  container: HTMLElement,
  optionValue: string,
): HTMLSelectElement {
  const select = Array.from(container.querySelectorAll("select")).find((candidate) =>
    Array.from(candidate.options).some((option) => option.value === optionValue),
  );
  if (!select) {
    throw new Error(`Select containing option "${optionValue}" was not found`);
  }
  return select;
}

describe("TaskCreateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    clearTaskDraft("panel-codex-draft-test");
    vi.useRealTimers();
  });

  it("opens correctly after an initial closed render", () => {
    const props = {
      workspaceId: "ws-1",
      workspaceBackendId: "ws-1",
      panelId: "panel-1",
      defaultStatus: "todo" as const,
      codexModels: emptyCodexModels,
      engineStatuses,
      availableTasks: [],
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };

    const { container, rerender } = render(
      <TaskCreateModal {...props} isOpen={false} />,
    );

    expect(container.querySelector(".kanban-task-modal")).toBeNull();

    expect(() => {
      rerender(<TaskCreateModal {...props} isOpen />);
    }).not.toThrow();

    expect(container.querySelector(".kanban-task-modal")).not.toBeNull();
  });

  it("uses backend workspace id for title generation", async () => {
    vi.mocked(generateThreadTitle).mockResolvedValue("Generated Title");

    const props = {
      workspaceId: "/tmp/workspace",
      workspaceBackendId: "workspace-uuid-1",
      panelId: "panel-1",
      defaultStatus: "todo" as const,
      codexModels: emptyCodexModels,
      engineStatuses,
      availableTasks: [],
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };

    const { getByPlaceholderText, getByTitle, getByDisplayValue } = render(
      <TaskCreateModal {...props} isOpen />,
    );

    fireEvent.change(
      getByPlaceholderText("kanban.task.descPlaceholder"),
      { target: { value: "fix login bug" } },
    );

    fireEvent.click(getByTitle("kanban.task.generateTitle"));

    await waitFor(() => {
      expect(generateThreadTitle).toHaveBeenCalledWith(
        "workspace-uuid-1",
        "temp-title-gen",
        "fix login bug",
        "en",
      );
    });

    await waitFor(() => {
      expect(getByDisplayValue("Generated Title")).toBeTruthy();
    });
    expect(pushErrorToast).not.toHaveBeenCalled();
  });

  it("shows timeout toast when title generation exceeds 15s", async () => {
    vi.useFakeTimers();
    vi.mocked(generateThreadTitle).mockImplementation(
      () => new Promise(() => {}),
    );

    const props = {
      workspaceId: "/tmp/workspace",
      workspaceBackendId: "workspace-uuid-1",
      panelId: "panel-1",
      defaultStatus: "todo" as const,
      codexModels: emptyCodexModels,
      engineStatuses,
      availableTasks: [],
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };

    const { getByPlaceholderText, getByTitle } = render(
      <TaskCreateModal {...props} isOpen />,
    );

    fireEvent.change(
      getByPlaceholderText("kanban.task.descPlaceholder"),
      { target: { value: "fix login bug" } },
    );

    fireEvent.click(getByTitle("kanban.task.generateTitle"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_001);
    });

    expect(pushErrorToast).toHaveBeenCalledWith({
      title: "kanban.task.generateTitleFailed",
      message: "kanban.task.generateTitleTimeout",
    });
  });

  it("clears blocked reason when updating an edited task", async () => {
    const onUpdate = vi.fn();
    const editingTask = {
      id: "task-1",
      workspaceId: "ws-1",
      panelId: "panel-1",
      title: "Recurring task",
      description: "desc",
      status: "todo",
      engineType: "claude",
      modelId: "claude-sonnet",
      branchName: "main",
      images: [],
      autoStart: false,
      sortOrder: 1,
      threadId: null,
      schedule: {
        mode: "recurring",
        interval: 1,
        unit: "minutes",
        nextRunAt: Date.now() + 60_000,
      },
      execution: {
        lastSource: "manual",
        blockedReason: "manual_blocked",
      },
      createdAt: 1,
      updatedAt: 1,
    } as any;

    const props = {
      workspaceId: "ws-1",
      workspaceBackendId: "ws-1",
      panelId: "panel-1",
      defaultStatus: "todo" as const,
      codexModels: emptyCodexModels,
      engineStatuses,
      availableTasks: [editingTask],
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      editingTask,
      onUpdate,
    };

    const { getByText } = render(<TaskCreateModal {...props} isOpen />);
    fireEvent.click(getByText("kanban.task.update"));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled();
    });

    const updateCall = onUpdate.mock.calls[0] ?? [];
    const [, changes] = updateCall;
    expect(changes.execution?.blockedReason).toBeNull();
  });

  it("shows upstream task type labels in chain selector options", () => {
    const props = {
      workspaceId: "ws-1",
      workspaceBackendId: "ws-1",
      panelId: "panel-1",
      defaultStatus: "todo" as const,
      codexModels: emptyCodexModels,
      engineStatuses,
      availableTasks: [
        {
          id: "task-manual",
          workspaceId: "ws-1",
          panelId: "panel-1",
          title: "Manual task",
          description: "",
          status: "todo",
          engineType: "claude",
          modelId: "claude-sonnet",
          branchName: "main",
          images: [],
          autoStart: false,
          sortOrder: 1,
          threadId: null,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "task-once",
          workspaceId: "ws-1",
          panelId: "panel-1",
          title: "One-time task",
          description: "",
          status: "todo",
          engineType: "claude",
          modelId: "claude-sonnet",
          branchName: "main",
          images: [],
          autoStart: false,
          sortOrder: 2,
          threadId: null,
          schedule: {
            mode: "once",
            runAt: Date.now() + 60_000,
          },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "task-recurring",
          workspaceId: "ws-1",
          panelId: "panel-1",
          title: "Recurring task",
          description: "",
          status: "todo",
          engineType: "claude",
          modelId: "claude-sonnet",
          branchName: "main",
          images: [],
          autoStart: false,
          sortOrder: 3,
          threadId: null,
          schedule: {
            mode: "recurring",
            interval: 1,
            unit: "days",
            nextRunAt: Date.now() + 60_000,
          },
          createdAt: 1,
          updatedAt: 1,
        },
      ] as any,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };

    const { container } = render(<TaskCreateModal {...props} isOpen />);

    const chainSelect = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "task-manual"),
    );
    const chainOptionLabels = Array.from(chainSelect?.options ?? []).map(
      (option) => option.textContent,
    );

    expect(chainOptionLabels).toContain("[kanban.task.schedule.manual] Manual task");
    expect(chainOptionLabels).toContain("[kanban.task.schedule.once] One-time task");
    expect(chainOptionLabels).toContain("[kanban.task.schedule.recurring] Recurring task");
  });

  it("shows start toggle only for manual schedule mode", () => {
    const props = {
      workspaceId: "ws-1",
      workspaceBackendId: "ws-1",
      panelId: "panel-1",
      defaultStatus: "todo" as const,
      codexModels: emptyCodexModels,
      engineStatuses,
      availableTasks: [],
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };

    const { getByRole, queryByText } = render(<TaskCreateModal {...props} isOpen />);

    expect(queryByText("kanban.task.start")).toBeTruthy();
    fireEvent.click(getByRole("radio", { name: "kanban.task.schedule.once" }));
    expect(queryByText("kanban.task.start")).toBeNull();
    fireEvent.click(getByRole("radio", { name: "kanban.task.schedule.manual" }));
    expect(queryByText("kanban.task.start")).toBeTruthy();
  });

  it("forces autoStart off when switching to non-manual schedule", async () => {
    const onSubmit = vi.fn();
    const props = {
      workspaceId: "ws-1",
      workspaceBackendId: "ws-1",
      panelId: "panel-1",
      defaultStatus: "inprogress" as const,
      codexModels: emptyCodexModels,
      engineStatuses,
      availableTasks: [],
      onSubmit,
      onCancel: vi.fn(),
    };

    const { container, getByPlaceholderText, getByRole, getByText } = render(
      <TaskCreateModal {...props} isOpen />,
    );

    const startToggle = container.querySelector(".kanban-toggle-input") as HTMLInputElement;
    expect(startToggle?.checked).toBe(true);

    fireEvent.click(getByRole("radio", { name: "kanban.task.schedule.recurring" }));
    fireEvent.change(getByPlaceholderText("kanban.task.titlePlaceholder"), {
      target: { value: "Recurring task" },
    });
    fireEvent.click(getByText("kanban.task.create"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(onSubmit.mock.calls[0]?.[0]?.autoStart).toBe(false);
    expect(onSubmit.mock.calls[0]?.[0]?.schedule?.mode).toBe("recurring");
  });

  it("uses the shared Codex catalog and submits its selected model", async () => {
    const onSubmit = vi.fn();
    const props = {
      workspaceId: "ws-1",
      workspaceBackendId: "ws-1",
      panelId: "panel-1",
      defaultStatus: "todo" as const,
      codexModels: sharedCodexModels,
      engineStatuses: engineStatusesWithLegacyCodexModels,
      availableTasks: [],
      onSubmit,
      onCancel: vi.fn(),
    };

    const { container, getByPlaceholderText, getByText } = render(
      <TaskCreateModal {...props} isOpen />,
    );

    fireEvent.change(findSelectWithOption(container, "codex"), {
      target: { value: "codex" },
    });

    await waitFor(() => {
      const modelSelect = findSelectWithOption(container, "gpt-5.6-sol");
      expect(Array.from(modelSelect.options).map((option) => option.value)).toEqual([
        "gpt-5.6-sol",
        "gpt-5.4",
      ]);
      expect(Array.from(modelSelect.options).map((option) => option.textContent)).toEqual([
        "GPT-5.6 Sol",
        "GPT-5.4",
      ]);
      expect(
        Array.from(modelSelect.options).some(
          (option) => option.value === "gpt-5.1-codex-max",
        ),
      ).toBe(false);
    });

    fireEvent.change(findSelectWithOption(container, "gpt-5.4"), {
      target: { value: "gpt-5.4" },
    });
    fireEvent.change(getByPlaceholderText("kanban.task.titlePlaceholder"), {
      target: { value: "Use shared catalog" },
    });
    fireEvent.click(getByText("kanban.task.create"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          engineType: "codex",
          modelId: "gpt-5.4",
        }),
      );
    });
  });

  it("uses the Product target catalog for every engine and submits the exact target", async () => {
    const onSubmit = vi.fn();
    const claudeStatus = engineStatuses.find(
      (status) => status.engineType === "claude",
    );
    if (!claudeStatus) {
      throw new Error("Claude status fixture is missing");
    }
    const productTargetCatalog = projectProductTargetCatalogV1({
      engines: [
        { id: "codex", displayName: "Codex" },
        { id: "claude-code", displayName: "Claude" },
        { id: "kimi", displayName: "Kimi CLI" },
      ],
      models: [
        {
          id: "kimi-code/kimi-for-coding",
          displayName: "Kimi For Coding",
          model: "kimi-for-coding",
          apiProtocols: [
            "openai-responses",
            "openai-chat-completions",
          ],
          capabilities: [],
        },
        {
          id: "claude-sonnet-4-8",
          displayName: "Claude Sonnet 4.8",
          model: "claude-sonnet-4-8",
          apiProtocols: ["anthropic-messages"],
          capabilities: [],
        },
      ],
    });
    const { container, getByPlaceholderText, getByText } = render(
      <TaskCreateModal
        isOpen
        workspaceId="ws-1"
        workspaceBackendId="ws-1"
        panelId="panel-product"
        defaultStatus="todo"
        codexModels={sharedCodexModels}
        engineStatuses={[
          ...engineStatusesWithLegacyCodexModels,
          {
            ...claudeStatus,
            engineType: "grok",
          },
        ]}
        productTargetCatalog={productTargetCatalog}
        availableTasks={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const engineSelect = findSelectWithOption(container, "kimi");
    expect(Array.from(engineSelect.options).map((option) => option.value)).toEqual([
      "codex",
      "claude",
      "kimi",
    ]);
    fireEvent.change(engineSelect, { target: { value: "kimi" } });

    await waitFor(() => {
      expect(
        Array.from(
          findSelectWithOption(container, "kimi-code/kimi-for-coding").options,
        ).map((option) => option.value),
      ).toEqual(["kimi-code/kimi-for-coding"]);
    });
    fireEvent.change(getByPlaceholderText("kanban.task.titlePlaceholder"), {
      target: { value: "Run Kimi target" },
    });
    fireEvent.click(getByText("kanban.task.create"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        engineType: "kimi",
        modelId: "kimi-code/kimi-for-coding",
        executionTarget: expect.objectContaining({
          engine: "kimi",
          providerProfileId: "doge-token-matrix",
          modelCatalogEntryId: "kimi-code/kimi-for-coding",
          model: "kimi-for-coding",
          providerProfileSource: "managed",
        }),
      }));
    });
  });

  it("preserves an edited Codex model when the modal first opens", async () => {
    const onUpdate = vi.fn();
    const editingTask: KanbanTask = {
      id: "task-codex-edit",
      workspaceId: "ws-1",
      panelId: "panel-1",
      title: "Keep edited model",
      description: "",
      status: "todo",
      engineType: "codex",
      modelId: "gpt-5.4",
      branchName: "main",
      images: [],
      autoStart: false,
      sortOrder: 1,
      threadId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const props = {
      workspaceId: "ws-1",
      workspaceBackendId: "ws-1",
      panelId: "panel-1",
      defaultStatus: "todo" as const,
      codexModels: sharedCodexModels,
      engineStatuses: engineStatusesWithLegacyCodexModels,
      availableTasks: [editingTask],
      editingTask,
      onSubmit: vi.fn(),
      onUpdate,
      onCancel: vi.fn(),
    };

    const { container, getByText, rerender } = render(
      <TaskCreateModal {...props} isOpen={false} />,
    );
    rerender(<TaskCreateModal {...props} isOpen />);

    await waitFor(() => {
      expect(findSelectWithOption(container, "gpt-5.4").value).toBe("gpt-5.4");
    });

    fireEvent.click(getByText("kanban.task.update"));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        "task-codex-edit",
        expect.objectContaining({
          engineType: "codex",
          modelId: "gpt-5.4",
        }),
      );
    });
  });

  it("preserves a drafted Codex model when the modal first opens", async () => {
    const panelId = "panel-codex-draft-test";
    const onSubmit = vi.fn();
    saveTaskDraft(panelId, {
      title: "Keep drafted model",
      description: "",
      engineType: "codex",
      modelId: "gpt-5.4",
      images: [],
    });
    const props = {
      workspaceId: "ws-1",
      workspaceBackendId: "ws-1",
      panelId,
      defaultStatus: "todo" as const,
      codexModels: sharedCodexModels,
      engineStatuses: engineStatusesWithLegacyCodexModels,
      availableTasks: [],
      onSubmit,
      onCancel: vi.fn(),
    };

    const { container, getByText, rerender } = render(
      <TaskCreateModal {...props} isOpen={false} />,
    );
    rerender(<TaskCreateModal {...props} isOpen />);

    await waitFor(() => {
      expect(findSelectWithOption(container, "gpt-5.4").value).toBe("gpt-5.4");
    });

    fireEvent.click(getByText("kanban.task.create"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          engineType: "codex",
          modelId: "gpt-5.4",
        }),
      );
    });
  });

  it("preserves valid Codex selection and falls back when the catalog removes it", async () => {
    const [defaultCodexModel, alternateCodexModel] = sharedCodexModels;
    if (!defaultCodexModel || !alternateCodexModel) {
      throw new Error("Shared Codex model fixtures are incomplete");
    }
    const props = {
      workspaceId: "ws-1",
      workspaceBackendId: "ws-1",
      panelId: "panel-1",
      defaultStatus: "todo" as const,
      codexModels: sharedCodexModels,
      engineStatuses: engineStatusesWithLegacyCodexModels,
      availableTasks: [],
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };

    const { container, rerender } = render(<TaskCreateModal {...props} isOpen />);
    fireEvent.change(findSelectWithOption(container, "codex"), {
      target: { value: "codex" },
    });
    await waitFor(() => {
      expect(findSelectWithOption(container, "gpt-5.4").value).toBe("gpt-5.6-sol");
    });

    fireEvent.change(findSelectWithOption(container, "gpt-5.4"), {
      target: { value: "gpt-5.4" },
    });
    rerender(
      <TaskCreateModal
        {...props}
        codexModels={[alternateCodexModel, defaultCodexModel]}
        isOpen
      />,
    );
    await waitFor(() => {
      expect(findSelectWithOption(container, "gpt-5.4").value).toBe("gpt-5.4");
    });

    const replacementCatalog: ModelOption[] = [
      {
        ...defaultCodexModel,
        id: "gpt-5.6-terra",
        model: "gpt-5.6-terra",
        displayName: "GPT-5.6 Terra",
        isDefault: true,
      },
    ];
    rerender(
      <TaskCreateModal
        {...props}
        codexModels={replacementCatalog}
        isOpen
      />,
    );
    await waitFor(() => {
      expect(findSelectWithOption(container, "gpt-5.6-terra").value).toBe(
        "gpt-5.6-terra",
      );
    });
    const modelSelect = findSelectWithOption(container, "gpt-5.6-terra");

    rerender(<TaskCreateModal {...props} codexModels={[]} isOpen />);
    await waitFor(() => {
      expect(Array.from(modelSelect.options).map((option) => option.value)).toEqual([""]);
      expect(modelSelect.value).toBe("");
    });
  });
});
