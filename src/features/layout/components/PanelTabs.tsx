import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Ellipsis from "lucide-react/dist/esm/icons/ellipsis";
import Eye from "lucide-react/dist/esm/icons/eye";
import Folder from "lucide-react/dist/esm/icons/folder";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Globe2 from "lucide-react/dist/esm/icons/globe-2";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Brain from "lucide-react/dist/esm/icons/brain";
import Search from "lucide-react/dist/esm/icons/search";
import Activity from "lucide-react/dist/esm/icons/activity";
import LayoutList from "lucide-react/dist/esm/icons/layout-list";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen";
import PenLine from "lucide-react/dist/esm/icons/pen-line";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import {
  ResponsiveIconToolbar,
  type ResponsiveIconToolbarItem,
} from "../../../components/ui/responsive-icon-toolbar";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";

export type PanelTabId =
  | "radar"
  | "git"
  | "files"
  | "search"
  | "notes"
  | "prompts"
  | "memory"
  | "activity"
  | "pluginPreview";

export type PanelToolbarTabId =
  | PanelTabId
  | "projectMap"
  | "intentCanvas"
  | "specHub"
  | "detachedExplorer";

type PanelTab = {
  id: PanelToolbarTabId;
  label: string;
  icon: ReactNode;
};

type PanelTabsProps = {
  active: PanelToolbarTabId;
  onSelect: (id: PanelToolbarTabId) => void;
  tabs?: PanelTab[];
  liveStates?: Partial<Record<PanelToolbarTabId, boolean>>;
  visibleTabs?: Partial<Record<PanelToolbarTabId, boolean>>;
};

// Toggle to show/hide prompts tab (set to true to re-enable)
const SHOW_PROMPTS_TAB = false;
// Toggle to show/hide git tab
const SHOW_GIT_TAB = true;

// 动作型条目：点击执行动作而非切换面板，选中后不外显到工具栏
const actionTabIds = new Set<PanelToolbarTabId>(["specHub", "detachedExplorer"]);

// 用户自选外显：菜单里勾选的面板以图标按钮形式常驻顶栏（仿 headerPinnedActions）
const RIGHT_PANEL_PINNED_TABS_KEY = "rightPanelPinnedTabs";
const DEFAULT_RIGHT_PANEL_PINNED_TABS: PanelToolbarTabId[] = [
  "files",
  "git",
  "search",
];

function useRightPanelPinnedTabs() {
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    const stored = getClientStoreSync<unknown>(
      "app",
      RIGHT_PANEL_PINNED_TABS_KEY,
    );
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : DEFAULT_RIGHT_PANEL_PINNED_TABS;
  });
  const togglePinned = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((pinnedId) => pinnedId !== id)
        : [...prev, id];
      writeClientStoreValue("app", RIGHT_PANEL_PINNED_TABS_KEY, next);
      return next;
    });
  }, []);
  return { pinnedIds, togglePinned };
}

const tabIds: PanelToolbarTabId[] = ([
  "files",
  "search",
  "git",
  "activity",
  "projectMap",
  "intentCanvas",
  "radar",
  "notes",
  "prompts",
  "specHub",
  "detachedExplorer",
] as const).filter(
  (id) =>
    (id !== "prompts" || SHOW_PROMPTS_TAB) &&
    (id !== "git" || SHOW_GIT_TAB)
);

const tabIcons: Record<PanelToolbarTabId, ReactNode> = {
  radar: <LayoutList aria-hidden />,
  git: <GitBranch aria-hidden />,
  files: <Folder aria-hidden />,
  search: <Search aria-hidden />,
  notes: <NotebookPen aria-hidden />,
  memory: <Brain aria-hidden />,
  pluginPreview: <Eye aria-hidden />,
  projectMap: <Globe2 aria-hidden />,
  intentCanvas: <PenLine aria-hidden />,
  activity: <Activity aria-hidden />,
  prompts: <ScrollText aria-hidden />,
  specHub: <LayoutDashboard aria-hidden />,
  detachedExplorer: <ExternalLink aria-hidden />,
};

const tabI18nKeys: Record<PanelToolbarTabId, string> = {
  radar: "panels.radar",
  git: "panels.git",
  files: "panels.files",
  search: "panels.search",
  notes: "panels.notes",
  memory: "panels.memory",
  pluginPreview: "pluginsPage.previewTitle",
  projectMap: "panels.projectMap",
  intentCanvas: "panels.intentCanvas",
  activity: "panels.activity",
  prompts: "panels.prompts",
  specHub: "sidebar.specHub",
  detachedExplorer: "files.openDetachedExplorer",
};

function PanelTabsImpl({
  active,
  onSelect,
  tabs,
  liveStates,
  visibleTabs,
}: PanelTabsProps) {
  const { t } = useTranslation();
  const { pinnedIds, togglePinned } = useRightPanelPinnedTabs();
  const resolvedTabs = useMemo(
    () =>
      tabs ??
      tabIds.map((id) => ({
        id,
        label: t(tabI18nKeys[id]),
        icon: tabIcons[id],
      })),
    [tabs, t],
  );
  const visibleResolvedTabs = useMemo(
    () => resolvedTabs.filter((tab) => visibleTabs?.[tab.id] !== false),
    [resolvedTabs, visibleTabs],
  );
  const toolbarItems = useMemo<ResponsiveIconToolbarItem[]>(
    () =>
      visibleResolvedTabs.map((tab, index) => {
        const isActive = active === tab.id;
        const isLive = Boolean(liveStates?.[tab.id]);
        const isAction = actionTabIds.has(tab.id);
        const isPinned = pinnedIds.includes(tab.id);
        return {
          id: tab.id,
          label: tab.label,
          icon: tab.icon,
          onSelect: () => onSelect(tab.id),
          priority: index,
          // 外显条件：激活 / 用户勾选（动作项永不外显）。
          // 刻意不再因 live 状态自动外显：未勾选的面板即使在对话/运行中也严格
          // 保持收纳在「更多」菜单里，完全按用户勾选来决定是否常驻顶栏。
          keepVisible: isActive || (!isAction && isPinned),
          noPromote: isAction,
          pinnable: !isAction,
          ariaCurrent: isActive ? "page" : undefined,
          buttonClassName: `panel-tab${isActive ? " is-active" : ""}${isLive ? " is-live" : ""}`,
          iconClassName: `panel-tab-icon${isLive ? " is-live" : ""}`,
          menuItemClassName: `panel-tab-menu-item${isActive ? " is-active" : ""}${isLive ? " is-live" : ""}`,
        };
      }),
    [active, liveStates, onSelect, pinnedIds, visibleResolvedTabs],
  );
  if (toolbarItems.length === 0) {
    return null;
  }

  return (
    <ResponsiveIconToolbar
      className="panel-tabs"
      role="tablist"
      ariaLabel="Panel"
      items={toolbarItems}
      overflowLabel={t("common.moreActions")}
      overflowIcon={<Ellipsis size={14} aria-hidden />}
      pinnedIds={pinnedIds}
      onTogglePin={togglePinned}
      pinToggleLabel={t("common.showInHeader")}
      itemWidth={29}
      overflowButtonWidth={30}
      collapseInactiveItems
    />
  );
}

export const PanelTabs = memo(PanelTabsImpl);
PanelTabs.displayName = "PanelTabs";
