import { useCallback, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { openWorkspaceIn, revealInFileManager } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { OpenAppTarget } from "../../../types";
import { recoverLocalFileLinkPath } from "../../../utils/remarkFileLinks";
import {
  clampRendererContextMenuPosition,
  estimateRendererContextMenuHeight,
  type RendererContextMenuItem,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";

type OpenTarget = {
  id: string;
  label: string;
  appName?: string | null;
  kind: OpenAppTarget["kind"];
  command?: string | null;
  args: string[];
};

const DEFAULT_OPEN_TARGET: OpenTarget = {
  id: "vscode",
  label: "VS Code",
  appName: "Visual Studio Code",
  kind: "app",
  command: null,
  args: [],
};

type FileLinkOpenerConfig = {
  workspacePath: string | null;
  openTargets: OpenAppTarget[];
  selectedOpenAppId: string;
  onOpenWorkspaceFile?: ((path: string) => void) | null;
};

function resolveConfiguredOpenTarget(
  openTargets: OpenAppTarget[],
  selectedOpenAppId: string,
) {
  return {
    ...DEFAULT_OPEN_TARGET,
    ...(openTargets.find((entry) => entry.id === selectedOpenAppId) ??
      openTargets[0]),
  };
}

function isWindowsAbsolutePath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
}

function toComparablePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function getWorkspaceRelativePath(path: string, workspacePath?: string | null) {
  if (!workspacePath) {
    return null;
  }
  const normalizedPath = toComparablePath(path);
  const normalizedWorkspacePath = toComparablePath(workspacePath);
  const caseInsensitive =
    isWindowsAbsolutePath(path) || isWindowsAbsolutePath(workspacePath);
  const comparablePath = caseInsensitive
    ? normalizedPath.toLowerCase()
    : normalizedPath;
  const comparableWorkspacePath = caseInsensitive
    ? normalizedWorkspacePath.toLowerCase()
    : normalizedWorkspacePath;
  if (comparablePath === comparableWorkspacePath) {
    return "";
  }
  if (!comparablePath.startsWith(`${comparableWorkspacePath}/`)) {
    return null;
  }
  return normalizedPath.slice(normalizedWorkspacePath.length + 1);
}

function normalizeLocalFilePath(path: string) {
  const trimmed = path.trim();
  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const decodedPath = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:[\\/]/.test(decodedPath)) {
        return decodedPath.slice(1);
      }
      if (url.hostname && url.hostname !== "localhost") {
        return `\\\\${url.hostname}${decodedPath.replace(/\//g, "\\")}`;
      }
      return recoverLocalFileLinkPath(decodedPath);
    } catch {
      return recoverLocalFileLinkPath(trimmed);
    }
  }
  const recovered = recoverLocalFileLinkPath(trimmed);
  if (/^\/[A-Za-z]:[\\/]/.test(recovered)) {
    return recovered.slice(1);
  }
  return recovered;
}

function resolveFilePath(path: string, workspacePath?: string | null) {
  const trimmed = normalizeLocalFilePath(path);
  if (!workspacePath) {
    return trimmed;
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("~/") ||
    isWindowsAbsolutePath(trimmed)
  ) {
    return trimmed;
  }
  const base = workspacePath.replace(/\/+$/, "");
  return `${base}/${trimmed}`;
}

function stripLineSuffix(path: string) {
  const withoutHashLine = path.replace(/#L?\d+(?:C\d+)?$/i, "");
  const match = withoutHashLine.match(/^(.*?)(?::\d+(?::\d+)?)?$/);
  return match ? (match[1] ?? withoutHashLine) : withoutHashLine;
}

function revealLabel() {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.platform ?? "";
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) {
    return "Reveal in Finder";
  }
  if (normalized.includes("win")) {
    return "Show in Explorer";
  }
  return "Reveal in File Manager";
}

export function useFileLinkOpener(
  workspacePath: string | null,
  openTargets: OpenAppTarget[],
  selectedOpenAppId: string,
  onOpenWorkspaceFile?: ((path: string) => void) | null,
) {
  const configRef = useRef<FileLinkOpenerConfig>({
    workspacePath,
    openTargets,
    selectedOpenAppId,
    onOpenWorkspaceFile,
  });
  configRef.current = {
    workspacePath,
    openTargets,
    selectedOpenAppId,
    onOpenWorkspaceFile,
  };
  const [fileLinkMenu, setFileLinkMenu] =
    useState<RendererContextMenuState | null>(null);

  const closeFileLinkMenu = useCallback(() => {
    setFileLinkMenu(null);
  }, []);

  const reportOpenError = useCallback(
    (error: unknown, context: Record<string, string | null>) => {
      const message = error instanceof Error ? error.message : String(error);
      pushErrorToast({
        title: "Couldn’t open file",
        message,
      });
      console.warn("Failed to open file link", { message, ...context });
    },
    [],
  );

  const openFileLinkInConfiguredTarget = useCallback(
    async (rawPath: string) => {
      const {
        workspacePath: currentWorkspacePath,
        openTargets: currentOpenTargets,
        selectedOpenAppId: currentSelectedOpenAppId,
      } = configRef.current;
      const target = resolveConfiguredOpenTarget(
        currentOpenTargets,
        currentSelectedOpenAppId,
      );
      const resolvedPath = resolveFilePath(stripLineSuffix(rawPath), currentWorkspacePath);

      try {
        if (target.kind === "finder") {
          await revealInFileManager(resolvedPath);
          return;
        }

        if (target.kind === "command") {
          if (!target.command) {
            return;
          }
          await openWorkspaceIn(resolvedPath, {
            command: target.command,
            args: target.args,
          });
          return;
        }

        const appName = (target.appName || target.label || "").trim();
        if (!appName) {
          return;
        }
        await openWorkspaceIn(resolvedPath, {
          appName,
          args: target.args,
        });
      } catch (error) {
        reportOpenError(error, {
          rawPath,
          resolvedPath,
          workspacePath: currentWorkspacePath,
          targetId: target.id,
          targetKind: target.kind,
          targetAppName: target.appName ?? null,
          targetCommand: target.command ?? null,
        });
      }
    },
    [reportOpenError],
  );

  const openFileLink = useCallback(
    async (rawPath: string) => {
      const {
        workspacePath: currentWorkspacePath,
        onOpenWorkspaceFile: currentOnOpenWorkspaceFile,
      } = configRef.current;
      const strippedPath = normalizeLocalFilePath(stripLineSuffix(rawPath).trim());
      const resolvedPath = resolveFilePath(strippedPath, currentWorkspacePath);
      const workspaceRelativePath = getWorkspaceRelativePath(
        resolvedPath,
        currentWorkspacePath,
      );
      const editorRelativePath =
        strippedPath.startsWith("/") ||
        strippedPath.startsWith("~/") ||
        isWindowsAbsolutePath(strippedPath)
          ? workspaceRelativePath !== null
            ? workspaceRelativePath
            : null
          : strippedPath.startsWith("./")
            ? strippedPath.slice(2)
            : strippedPath.startsWith("../")
              ? null
              : strippedPath;
      if (currentOnOpenWorkspaceFile && editorRelativePath) {
        currentOnOpenWorkspaceFile(editorRelativePath);
        return;
      }
      try {
        await openPath(resolvedPath);
      } catch {
        await openFileLinkInConfiguredTarget(rawPath);
      }
    },
    [openFileLinkInConfiguredTarget],
  );

  const showFileLinkMenu = useCallback(
    (event: MouseEvent, rawPath: string) => {
      event.preventDefault();
      event.stopPropagation();
      const {
        workspacePath: currentWorkspacePath,
        openTargets: currentOpenTargets,
        selectedOpenAppId: currentSelectedOpenAppId,
      } = configRef.current;
      const target = resolveConfiguredOpenTarget(
        currentOpenTargets,
        currentSelectedOpenAppId,
      );
      const resolvedPath = resolveFilePath(stripLineSuffix(rawPath), currentWorkspacePath);
      const appName = (target.appName || target.label || "").trim();
      const items: RendererContextMenuItem[] = [
        {
          type: "item",
          id: "open-file",
          label: "Open File",
          onSelect: async () => {
            await openFileLink(rawPath);
          },
        },
        {
          type: "item",
          id: "open-configured-target",
          label:
            target.kind === "finder"
              ? revealLabel()
              : target.kind === "command"
                ? `Open in ${target.label}`
                : appName
                  ? `Open in ${appName}`
                  : "Open Link",
          onSelect: async () => {
            await openFileLinkInConfiguredTarget(rawPath);
          },
        },
        ...(target.kind === "finder"
          ? []
          : [
              {
                type: "item" as const,
                id: "reveal",
                label: revealLabel(),
                onSelect: async () => {
                  try {
                    await revealInFileManager(resolvedPath);
                  } catch (error) {
                    reportOpenError(error, {
                      rawPath,
                      resolvedPath,
                      workspacePath: currentWorkspacePath,
                      targetId: target.id,
                      targetKind: "finder",
                      targetAppName: null,
                      targetCommand: null,
                    });
                  }
                },
              },
            ]),
        {
          type: "item",
          id: "download-linked-file",
          label: "Download Linked File",
          disabled: true,
          onSelect: () => undefined,
        },
        {
          type: "item",
          id: "copy-link",
          label: "Copy Link",
          onSelect: async () => {
            const link =
              resolvedPath.startsWith("/") ? `file://${resolvedPath}` : resolvedPath;
            try {
              await navigator.clipboard.writeText(link);
            } catch {
              // Clipboard failures are non-fatal here.
            }
          },
        },
      ];

      const position = clampRendererContextMenuPosition(event.clientX, event.clientY, {
        width: 260,
        height: estimateRendererContextMenuHeight(items),
      });
      setFileLinkMenu({
        ...position,
        label: "File link actions",
        items,
      });
    },
    [openFileLink, openFileLinkInConfiguredTarget, reportOpenError],
  );

  return { openFileLink, showFileLinkMenu, fileLinkMenu, closeFileLinkMenu };
}
