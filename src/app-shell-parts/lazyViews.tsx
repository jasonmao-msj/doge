import { lazy } from "react";

export const SettingsView = lazy(() =>
  import("../features/settings/components/SettingsView").then((module) => ({
    default: module.SettingsView,
  })),
);

export const GitHubPanelData = lazy(() =>
  import("../features/git/components/GitHubPanelData").then((module) => ({
    default: module.GitHubPanelData,
  })),
);

export const KanbanView = lazy(() =>
  import("../features/kanban/components/KanbanView").then((module) => ({
    default: module.KanbanView,
  })),
);

export const PluginsView = lazy(() =>
  import("../features/plugins/components/PluginsView").then((module) => ({
    default: module.PluginsView,
  })),
);

export const GitHistoryPanel = lazy(() =>
  import("../features/git-history/components/GitHistoryPanel").then((module) => ({
    default: module.GitHistoryPanel,
  })),
);

export const WorkspaceHome = lazy(() =>
  import("../features/workspaces/components/WorkspaceHome").then((module) => ({
    default: module.WorkspaceHome,
  })),
);

export const SpecHub = lazy(() =>
  import("../features/spec/components/SpecHub").then((module) => ({
    default: module.SpecHub,
  })),
);

export const SearchPalette = lazy(() =>
  import("../features/search/components/SearchPalette").then((module) => ({
    default: module.SearchPalette,
  })),
);

export const ReleaseNotesModal = lazy(() =>
  import("../features/update/components/ReleaseNotesModal").then((module) => ({
    default: module.ReleaseNotesModal,
  })),
);
