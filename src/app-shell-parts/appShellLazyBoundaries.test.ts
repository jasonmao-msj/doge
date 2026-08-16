import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(currentDir, "..");

const lazyFeatureImports = [
  "../features/kanban/components/KanbanView",
  "../features/git-history/components/GitHistoryPanel",
  "../features/workspaces/components/WorkspaceHome",
  "../features/spec/components/SpecHub",
  "../features/search/components/SearchPalette",
  "../features/update/components/ReleaseNotesModal",
  "../../project-map/components/ProjectMapPanel",
  "../../intent-canvas/components/IntentCanvasManager",
] as const;

const shellStaticImportFiles = [
  join(srcDir, "app-shell.tsx"),
  join(currentDir, "renderAppShell.tsx"),
  join(currentDir, "useAppShellLayoutNodesSection.tsx"),
  join(srcDir, "features/layout/hooks/useLayoutNodes.tsx"),
] as const;

const releaseNotesControllerPath = join(
  srcDir,
  "features/update/hooks/useReleaseNotes.ts",
);

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

describe("AppShell lazy feature boundaries", () => {
  it("keeps inactive feature views out of AppShell static imports", () => {
    for (const sourcePath of shellStaticImportFiles) {
      const source = readSource(sourcePath);

      for (const importPath of lazyFeatureImports) {
        expect(source).not.toContain(`from "${importPath}"`);
        expect(source).not.toContain(`from '${importPath}'`);
      }
    }
  });

  it("loads inactive feature views through statically analyzable dynamic imports", () => {
    const lazyViewsSource = readSource(join(currentDir, "lazyViews.tsx"));
    const layoutNodesSource = readSource(join(srcDir, "features/layout/hooks/useLayoutNodes.tsx"));

    for (const importPath of lazyFeatureImports.slice(0, 6)) {
      expect(lazyViewsSource).toContain(`import("${importPath}")`);
    }
    for (const importPath of lazyFeatureImports.slice(6)) {
      expect(layoutNodesSource).toContain(`import("${importPath}")`);
    }
  });

  it("keeps release notes changelog data out of startup static imports", () => {
    const source = readSource(releaseNotesControllerPath);

    expect(source).not.toContain(`from "../../../../CHANGELOG.md?raw"`);
    expect(source).toContain(`import("../../../../CHANGELOG.md?raw")`);
  });

  it("keeps the preview configuration bubble behind a build-time lazy boundary", () => {
    const renderSource = readSource(join(currentDir, "renderAppShell.tsx"));

    expect(renderSource).toContain("ACCOUNT_UI_PREVIEW_V1_ENABLED");
    expect(renderSource).toContain(
      'import("../features/account/components/AccountPreviewConfigurationBubbleHost")',
    );
    expect(renderSource).not.toContain(
      'from "../features/account/components/AccountPreviewConfigurationBubbleHost"',
    );
  });

  it("mounts heavy canvas surfaces only when their surface is active", () => {
    const layoutNodesSource = readSource(join(srcDir, "features/layout/hooks/useLayoutNodes.tsx"));
    const shellSectionSource = readSource(join(currentDir, "useAppShellLayoutNodesSection.tsx"));

    expect(layoutNodesSource).toContain(
      "const projectMapPanelNode = isProjectMapSurfaceActive ?",
    );
    expect(layoutNodesSource).toContain(
      "const intentCanvasPanelNode = isIntentCanvasSurfaceActive ?",
    );
    expect(shellSectionSource).toContain("enabled: isProjectMapDatasetEnabled");
  });

  it("reuses the global home composer for workspace-scoped home", () => {
    const renderSource = readSource(join(currentDir, "renderAppShell.tsx"));
    const sectionsSource = readSource(join(currentDir, "useAppShellSections.ts"));

    expect(renderSource).toContain(
      "const workspaceHomeNode = showWorkspaceHome ? homeNode : null;",
    );
    expect(renderSource).toContain(
      "composerNode={showWorkspaceHome ? null : composerNode}",
    );
    expect(sectionsSource).toContain("showWorkspaceHome ||");
    expect(renderSource).not.toContain("<WorkspaceHome");
  });

  it("keeps sidebar props on a shell summary instead of the full realtime item stream", () => {
    const layoutNodesSource = readSource(join(srcDir, "features/layout/hooks/useLayoutNodes.tsx"));
    const sidebarSource = readSource(join(srcDir, "features/app/components/Sidebar.tsx"));

    expect(layoutNodesSource).toContain("buildShellRuntimeSummary");
    expect(layoutNodesSource).toContain("activeItems={sidebarActiveItems}");
    expect(sidebarSource).toContain("export const Sidebar = memo(SidebarImpl)");
  });

  it("keeps conversation canvas rendering behind a dedicated node builder", () => {
    const layoutNodesSource = readSource(join(srcDir, "features/layout/hooks/useLayoutNodes.tsx"));
    const canvasNodeSource = readSource(join(srcDir, "features/layout/hooks/conversationCanvasNode.tsx"));

    expect(layoutNodesSource).toContain("buildConversationCanvasNode");
    expect(layoutNodesSource).not.toContain(
      `from "../../messages/components/Messages"`,
    );
    expect(canvasNodeSource).toContain("function ActiveCanvasMessages");
    expect(canvasNodeSource).toContain("useActiveCanvasSelector");
    expect(canvasNodeSource).toContain(
      "<Messages {...messagesProps} {...activeCanvasMessagesProps} />",
    );
    expect(canvasNodeSource).toContain(
      "<MessageForkConfirmDialog {...forkConfirmDialogProps} />",
    );
  });
});
