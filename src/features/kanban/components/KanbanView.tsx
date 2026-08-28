import type { ReactNode } from "react";
import { useMemo } from "react";
import type {
  AppMode,
  EngineStatus,
  EngineType,
  ModelOption,
  WorkspaceInfo,
} from "../../../types";
import { useProductEntitlementSnapshotV1 } from "../../account/runtime/productEntitlementStore";
import {
  projectProductTargetCatalogV1,
  type ProductTargetCatalogV1,
} from "../../account/runtime/productTargetCatalog";
import { loadKanbanStyles } from "../../../styles/featureStyleLoaders";
import { useFeatureStylesReady } from "../../../styles/useFeatureStylesReady";
import type {
  KanbanTaskChain,
  KanbanTaskSchedule,
  KanbanPanel,
  KanbanTask,
  KanbanTaskStatus,
  KanbanViewState,
} from "../types";
import { ProjectList } from "./ProjectList";
import { PanelList } from "./PanelList";
import { KanbanBoard } from "./KanbanBoard";
import { KANBAN_COLUMNS } from "../constants";

type CreateTaskInput = {
  workspaceId: string;
  panelId: string;
  title: string;
  description: string;
  engineType: EngineType;
  modelId: string | null;
  executionTarget: KanbanTask["executionTarget"];
  branchName: string;
  images: string[];
  autoStart: boolean;
  schedule?: KanbanTaskSchedule;
  chain?: KanbanTaskChain;
};

type KanbanViewProps = {
  viewState: KanbanViewState;
  onViewStateChange: (state: KanbanViewState) => void;
  workspaces: WorkspaceInfo[];
  panels: KanbanPanel[];
  tasks: KanbanTask[];
  onCreateTask: (input: CreateTaskInput) => KanbanTask;
  onUpdateTask: (taskId: string, changes: Partial<KanbanTask>) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderTask: (
    taskId: string,
    newStatus: KanbanTaskStatus,
    newSortOrder: number
  ) => void;
  onCreatePanel: (input: { workspaceId: string; name: string }) => KanbanPanel;
  onUpdatePanel: (panelId: string, changes: Partial<KanbanPanel>) => void;
  onDeletePanel: (panelId: string) => void;
  onAddWorkspace: () => void;
  onAppModeChange: (mode: AppMode) => void;
  codexModels: ModelOption[];
  engineStatuses: EngineStatus[];
  conversationNode: ReactNode | null;
  selectedTaskId: string | null;
  taskProcessingMap: Record<string, { isProcessing: boolean; startedAt: number | null }>;
  onOpenTaskConversation: (task: KanbanTask) => void;
  onCloseTaskConversation: () => void;
  onDragToInProgress: (task: KanbanTask) => void;
  kanbanConversationWidth?: number;
  onKanbanConversationResizeStart?: (event: React.MouseEvent<HTMLDivElement>) => void;
  gitPanelNode: ReactNode | null;
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
};

export function KanbanView({
  viewState,
  onViewStateChange,
  workspaces,
  panels,
  tasks,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onReorderTask,
  onCreatePanel,
  onUpdatePanel,
  onDeletePanel,
  onAddWorkspace,
  onAppModeChange,
  codexModels,
  engineStatuses,
  conversationNode,
  selectedTaskId,
  taskProcessingMap,
  onOpenTaskConversation,
  onCloseTaskConversation,
  onDragToInProgress,
  kanbanConversationWidth,
  onKanbanConversationResizeStart,
  gitPanelNode,
  terminalOpen,
  onToggleTerminal,
}: KanbanViewProps) {
  const stylesReady = useFeatureStylesReady(loadKanbanStyles);
  const productEntitlement = useProductEntitlementSnapshotV1();
  const productTargetCatalog = useMemo<ProductTargetCatalogV1 | null>(
    () => productEntitlement.status === "ready"
      ? projectProductTargetCatalogV1({
          engines: productEntitlement.engines,
          models: productEntitlement.models,
          modelsStatus: productEntitlement.modelsStatus,
          modelsUpdatedAt: productEntitlement.modelsUpdatedAt,
        })
      : null,
    [
      productEntitlement.engines,
      productEntitlement.models,
      productEntitlement.modelsStatus,
      productEntitlement.modelsUpdatedAt,
      productEntitlement.status,
    ],
  );
  const handleSelectWorkspace = useMemo(
    () => (workspaceId: string) => {
      onCloseTaskConversation();
      onViewStateChange({ view: "panels", workspaceId });
    },
    [onCloseTaskConversation, onViewStateChange]
  );
  if (!stylesReady) {
    return null;
  }

  // --- Board view ---
  if (viewState.view === "board") {
    const workspace = workspaces.find((w) => w.path === viewState.workspaceId);
    if (!workspace) {
      onViewStateChange({ view: "projects" });
      return null;
    }
    const panel = panels.find((p) => p.id === viewState.panelId);
    if (!panel) {
      onViewStateChange({ view: "panels", workspaceId: viewState.workspaceId });
      return null;
    }
    const panelTasks = tasks.filter(
      (t) => t.panelId === viewState.panelId
    );
    const workspacePanels = panels
      .filter((p) => p.workspaceId === viewState.workspaceId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return (
      <KanbanBoard
        workspace={workspace}
        workspaces={workspaces}
        panel={panel}
        panels={workspacePanels}
        tasks={panelTasks}
        columns={KANBAN_COLUMNS}
        onBack={() => {
          onCloseTaskConversation();
          onViewStateChange({ view: "panels", workspaceId: viewState.workspaceId });
        }}
        onCreateTask={onCreateTask}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        onReorderTask={onReorderTask}
        onAppModeChange={onAppModeChange}
        codexModels={codexModels}
        engineStatuses={engineStatuses}
        productTargetCatalog={productTargetCatalog}
        conversationNode={conversationNode}
        selectedTaskId={selectedTaskId}
        taskProcessingMap={taskProcessingMap}
        onSelectTask={onOpenTaskConversation}
        onCloseConversation={onCloseTaskConversation}
        onDragToInProgress={onDragToInProgress}
        onSelectWorkspace={(workspaceId: string) => {
          onCloseTaskConversation();
          onViewStateChange({ view: "panels", workspaceId });
        }}
        onSelectPanel={(panelId: string) => {
          onCloseTaskConversation();
          onViewStateChange({ view: "board", workspaceId: viewState.workspaceId, panelId });
        }}
        kanbanConversationWidth={kanbanConversationWidth}
        onKanbanConversationResizeStart={onKanbanConversationResizeStart}
        gitPanelNode={gitPanelNode}
        terminalOpen={terminalOpen}
        onToggleTerminal={onToggleTerminal}
      />
    );
  }

  // --- Panels view ---
  if (viewState.view === "panels") {
    const workspace = workspaces.find((w) => w.path === viewState.workspaceId);
    if (!workspace) {
      onViewStateChange({ view: "projects" });
      return null;
    }
    const workspacePanels = panels.filter(
      (p) => p.workspaceId === viewState.workspaceId
    );
    const workspaceTasks = tasks.filter(
      (t) => t.workspaceId === viewState.workspaceId
    );

    return (
      <PanelList
        workspace={workspace}
        panels={workspacePanels}
        tasks={workspaceTasks}
        onBack={() => onViewStateChange({ view: "projects" })}
        onSelectPanel={(panelId) =>
          onViewStateChange({ view: "board", workspaceId: viewState.workspaceId, panelId })
        }
        onCreatePanel={(name) =>
          onCreatePanel({ workspaceId: viewState.workspaceId, name })
        }
        onRenamePanel={(panelId, name) =>
          onUpdatePanel(panelId, { name })
        }
        onDeletePanel={onDeletePanel}
        onAppModeChange={onAppModeChange}
      />
    );
  }

  // --- Projects view ---
  return (
    <ProjectList
      workspaces={workspaces}
      tasks={tasks}
      onSelectWorkspace={handleSelectWorkspace}
      onAddWorkspace={onAddWorkspace}
      onAppModeChange={onAppModeChange}
    />
  );
}
