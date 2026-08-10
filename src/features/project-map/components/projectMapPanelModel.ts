import type { ModelOption } from "../../../types";
import { getSortedProjectMapChildren } from "../utils/interactiveLayout";
import type {
  ProjectMapGraphNodePosition,
  ProjectMapGraphViewport,
} from "../utils/interactiveLayout";
import type {
  ProjectMapLens,
  ProjectMapNode,
  ProjectMapPreferredLanguage,
  ProjectMapProfile,
  ProjectMapQuickFilterId,
} from "../types";

export type GraphViewport = ProjectMapGraphViewport;

export type GraphViewSnapshot = {
  focusNodeId: string | null;
  selectedNodeId: string | null;
};

export type ProjectMapVisibleSectionState = {
  navigation: boolean;
  query: boolean;
  activity: boolean;
  evidence: boolean;
  fileRelations: boolean;
  relations: boolean;
  advisor: boolean;
  health: boolean;
};

export type GraphNodeDragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  nodeIds: string[];
  originPositions: Map<string, ProjectMapGraphNodePosition>;
  previewPositions: Map<string, ProjectMapGraphNodePosition>;
  didMove: boolean;
};

export const ZOOM_STEP = 0.1;
export const MINI_MAP_SIZE = { width: 180, height: 118 };
export const PROJECT_MAP_RELATION_FILTER_ALL = "all";
export const PROJECT_MAP_QUICK_FILTERS: ProjectMapQuickFilterId[] = [
  "changed",
  "affected",
  "stale",
  "candidate",
  "low-confidence",
  "inferred-relations",
];

const DETAIL_PANEL_FOCUS_OFFSET_MIN = 160;
const DETAIL_PANEL_FOCUS_OFFSET_MAX = 240;
const CANVAS_CONTROLS_COLLAPSED_STORAGE_KEY = "doge.projectMap.canvasControlsCollapsed";
const PROJECT_MAP_LOCAL_HISTORY_LIMIT = 6;

export function normalizeLocalHistoryLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function appendUniqueLocalHistory<T>(
  current: T[],
  nextItem: T,
  getKey: (item: T) => string,
): T[] {
  const nextKey = getKey(nextItem);
  if (!nextKey) {
    return current;
  }
  return [
    nextItem,
    ...current.filter((item) => getKey(item) !== nextKey),
  ].slice(0, PROJECT_MAP_LOCAL_HISTORY_LIMIT);
}

export function readCanvasControlsCollapsedPreference(): boolean {
  if (typeof window === "undefined" || !window.localStorage) {
    return true;
  }

  try {
    const storedValue = window.localStorage.getItem(CANVAS_CONTROLS_COLLAPSED_STORAGE_KEY);
    return storedValue === null ? true : storedValue === "true";
  } catch {
    return true;
  }
}

export function writeCanvasControlsCollapsedPreference(collapsed: boolean): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(CANVAS_CONTROLS_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // UI preference persistence is best-effort.
  }
}

export function resolveSelectedGenerationModel(
  selectedModelId: string | null | undefined,
  models: ModelOption[] | undefined,
): string | null {
  const trimmedSelection = selectedModelId?.trim() ?? "";
  if (!trimmedSelection) {
    return null;
  }
  const matchedModel = models?.find(
    (model) => model.id === trimmedSelection || model.model === trimmedSelection,
  );
  return matchedModel?.model ?? trimmedSelection;
}

export function getDetailPanelFocusOffset(input: {
  canvasElement: HTMLDivElement | null;
  isDetailCollapsed: boolean;
}): number {
  if (input.isDetailCollapsed) {
    return 0;
  }

  const detailPanel = input.canvasElement?.querySelector<HTMLElement>(".project-map-detail-panel");
  const detailWidth = detailPanel?.getBoundingClientRect().width ?? 0;
  const fallbackWidth = 478;
  const offset = Math.max(
    DETAIL_PANEL_FOCUS_OFFSET_MIN,
    (detailWidth > 0 ? detailWidth : fallbackWidth) / 2,
  );
  return -Math.min(DETAIL_PANEL_FOCUS_OFFSET_MAX, offset);
}

export function buildLensIndex(lenses: ProjectMapLens[]): Map<string, ProjectMapLens> {
  return new Map(lenses.map((lens) => [lens.id, lens]));
}

export function buildNeighborSet(
  nodes: ProjectMapNode[],
  selectedNodeId: string | null,
  hoverNodeId: string | null,
  isFocusedView: boolean,
): Set<string> {
  const focusNodeId = hoverNodeId ?? (isFocusedView ? selectedNodeId : null);
  if (!focusNodeId) {
    return new Set(nodes.map((node) => node.id));
  }
  const focusedNode = nodes.find((node) => node.id === focusNodeId);
  if (!focusedNode) {
    return new Set(nodes.map((node) => node.id));
  }
  return new Set([
    focusedNode.id,
    focusedNode.parentId ?? "",
    ...focusedNode.children,
    ...nodes
      .filter((node) => node.children.includes(focusedNode.id))
      .map((node) => node.id),
  ].filter(Boolean));
}

export function getDescendantStats(
  node: ProjectMapNode,
  nodeIndex: Map<string, ProjectMapNode>,
): {
  count: number;
  stale: number;
  candidate: number;
} {
  const children = getSortedProjectMapChildren(node, nodeIndex);
  return {
    count: children.length,
    stale: children.filter((child) => child.stale).length,
    candidate: children.filter((child) => child.candidate).length,
  };
}

export function getProfileSummary(profile: Partial<ProjectMapProfile> | null | undefined): {
  language: string;
  shapes: string;
} {
  const language = profile?.primaryLanguage ?? "unknown";
  const shapes = profile?.shapes?.length ? profile.shapes.join(" · ") : "unknown";
  return { language, shapes };
}

export function resolveProjectMapPreferredLanguage(
  language: string | null | undefined,
): ProjectMapPreferredLanguage {
  return language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}
