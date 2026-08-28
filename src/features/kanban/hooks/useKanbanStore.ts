import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KanbanTaskChain,
  KanbanTaskExecutionState,
  KanbanTaskSchedule,
  KanbanPanel,
  KanbanTask,
  KanbanTaskStatus,
  KanbanStoreData,
  KanbanViewState,
} from "../types";
import type { EngineType, WorkspaceInfo } from "../../../types";
import { loadKanbanData, migrateWorkspaceIds, saveKanbanData } from "../utils/kanbanStorage";
import { hasKanbanImageDataUrl, persistKanbanImages } from "../utils/kanbanImages";
import { generateKanbanId, generatePanelId } from "../utils/kanbanId";

type CreateTaskInput = {
  workspaceId: string;
  panelId: string;
  title: string;
  description: string;
  engineType: EngineType;
  modelId: string | null;
  executionTarget?: KanbanTask["executionTarget"];
  branchName: string;
  images: string[];
  autoStart: boolean;
  schedule?: KanbanTaskSchedule;
  chain?: KanbanTaskChain;
};

type CreatePanelInput = {
  workspaceId: string;
  name: string;
};

export function useKanbanStore(workspaces?: WorkspaceInfo[]) {
  const [store, setStore] = useState<KanbanStoreData>(() => loadKanbanData());
  const [viewState, setViewState] = useState<KanbanViewState>({
    view: "projects",
  });

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveKanbanData(store);
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [store]);

  // Migrate: 存量任务里内嵌的 base64 data URL 图片异步落盘为文件路径。
  // 这类 base64 曾把 app.json 撑到 ~24MB，是每次 kanban 写盘都要付出的体积成本。
  const imageMigrationRef = useRef(false);
  useEffect(() => {
    if (imageMigrationRef.current) {
      return;
    }
    imageMigrationRef.current = true;
    const tasksToMigrate = store.tasks.filter((task) => hasKanbanImageDataUrl(task.images));
    if (tasksToMigrate.length === 0) {
      return;
    }
    void (async () => {
      for (const task of tasksToMigrate) {
        const migratedImages = await persistKanbanImages(task.images);
        if (migratedImages.every((image, index) => image === task.images[index])) {
          continue;
        }
        setStore((prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === task.id ? { ...t, images: migratedImages } : t,
          ),
        }));
      }
    })();
  }, [store.tasks]);

  // Migrate: convert old UUID-based workspaceId to workspace path
  const migratedRef = useRef(false);
  useEffect(() => {
    if (!workspaces?.length || migratedRef.current) return;
    const idToPath = new Map(workspaces.map((w) => [w.id, w.path]));
    const result = migrateWorkspaceIds(store, idToPath);
    if (result.migrated) {
      migratedRef.current = true;
      setStore(result.data);
    } else {
      migratedRef.current = true;
    }
  }, [workspaces, store]);

  // --- Panel CRUD ---

  const createPanel = useCallback((input: CreatePanelInput): KanbanPanel => {
    const now = Date.now();
    const panel: KanbanPanel = {
      id: generatePanelId(),
      workspaceId: input.workspaceId,
      name: input.name,
      sortOrder: now,
      createdAt: now,
      updatedAt: now,
    };
    setStore((prev) => ({
      ...prev,
      panels: [...prev.panels, panel],
    }));
    return panel;
  }, []);

  const updatePanel = useCallback(
    (panelId: string, changes: Partial<KanbanPanel>) => {
      setStore((prev) => ({
        ...prev,
        panels: prev.panels.map((p) =>
          p.id === panelId ? { ...p, ...changes, updatedAt: Date.now() } : p
        ),
      }));
    },
    []
  );

  const deletePanel = useCallback((panelId: string) => {
    setStore((prev) => ({
      ...prev,
      panels: prev.panels.filter((p) => p.id !== panelId),
      tasks: prev.tasks.filter((t) => t.panelId !== panelId),
    }));
  }, []);

  // --- Task CRUD ---

  const createTask = useCallback((input: CreateTaskInput): KanbanTask => {
    const now = Date.now();
    const taskId = generateKanbanId();
    const schedule = input.schedule?.mode === "recurring" &&
      input.schedule.recurringExecutionMode === "new_thread"
      ? {
          ...input.schedule,
          seriesId: input.schedule.seriesId ?? taskId,
        }
      : input.schedule;
    const execution: KanbanTaskExecutionState = {
      lastSource: input.autoStart ? "autoStart" : "manual",
      lock: null,
      blockedReason: null,
      startedAt: null,
      finishedAt: null,
    };
    const task: KanbanTask = {
      id: taskId,
      workspaceId: input.workspaceId,
      panelId: input.panelId,
      title: input.title,
      description: input.description,
      status: "todo",
      engineType: input.engineType,
      modelId: input.modelId,
      executionTarget: input.executionTarget,
      branchName: input.branchName,
      images: input.images,
      autoStart: input.autoStart,
      sortOrder: now,
      threadId: null,
      schedule,
      chain: input.chain,
      lastResultSnapshot: null,
      execution,
      createdAt: now,
      updatedAt: now,
    };
    setStore((prev) => ({
      ...prev,
      tasks: [...prev.tasks, task],
    }));
    return task;
  }, []);

  const updateTask = useCallback(
    (taskId: string, changes: Partial<KanbanTask>) => {
      setStore((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId ? { ...t, ...changes, updatedAt: Date.now() } : t
        ),
      }));
    },
    []
  );

  const deleteTask = useCallback((taskId: string) => {
    setStore((prev) => ({
      ...prev,
      tasks: prev.tasks.filter((t) => t.id !== taskId),
    }));
  }, []);

  const reorderTask = useCallback(
    (taskId: string, newStatus: KanbanTaskStatus, newSortOrder: number) => {
      setStore((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: newStatus,
                sortOrder: newSortOrder,
                updatedAt: Date.now(),
              }
            : t
        ),
      }));
    },
    []
  );

  return {
    panels: store.panels,
    tasks: store.tasks,
    kanbanViewState: viewState,
    setKanbanViewState: setViewState,
    createPanel,
    updatePanel,
    deletePanel,
    createTask,
    updateTask,
    deleteTask,
    reorderTask,
  };
}
