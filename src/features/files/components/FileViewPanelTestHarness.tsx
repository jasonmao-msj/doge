/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLocation,
  buildWindowsLocation,
  mermaidInitialize,
  mermaidRender,
  mockCodeMirrorDispatch,
  mockOpenNewDetachedFileExplorerWindow,
  mockPushErrorToast,
} from "./FileViewPanel.test-utils";
import {
  FileViewPanel,
  resolveEditorAnnotationWidgetOrder,
} from "./FileViewPanel";
import { clearFileDocumentSessionCacheForTests } from "../hooks/useFileDocumentState";
import {
  getCodeIntelDefinition,
  getCodeIntelImplementations,
  getCodeIntelReferences,
  getGitFileFullDiff,
  prepareCodeIntel,
  readLocalImageDataUrl,
  readExternalAbsoluteFile,
  readExternalSpecFile,
  readWorkspaceFile,
  writeExternalSpecFile,
  writeWorkspaceFile,
} from "../../../services/tauri";
import { loadKatexAssets } from "../../markdown/markdownMath";
import { useFilePreviewPayload } from "../hooks/useFilePreviewPayload";
import { getFileTreeIconSvg } from "@/utils/fileTreeIcons";

function openFileContentContextMenu() {
  const contextTarget =
    screen.queryByTestId("mock-codemirror") ??
    document.querySelector(".fvp-body");
  if (!contextTarget) {
    throw new Error("File content surface is unavailable");
  }
  fireEvent.contextMenu(contextTarget, {
    clientX: 120,
    clientY: 80,
  });
  return screen.getByRole("menu", { name: "files.fileContextMenu" });
}

function clickFileContextMenuItem(name: string | RegExp) {
  fireEvent.click(
    within(openFileContentContextMenu()).getByRole("menuitem", { name }),
  );
}

function toggleFileGitBlame() {
  const menu = within(openFileContentContextMenu());
  fireEvent.mouseEnter(
    menu.getByRole("menuitem", { name: "files.tabGitActions" }),
  );
  const gitMenu = within(
    screen.getByRole("menu", { name: "files.tabGitActions" }),
  );
  const item =
    gitMenu.queryByRole("menuitem", { name: "files.gitBlameEnable" }) ??
    gitMenu.getByRole("menuitem", { name: "files.gitBlameDisable" });
  fireEvent.click(item);
}

export {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  afterEach,
  describe,
  expect,
  it,
  vi,
  buildLocation,
  buildWindowsLocation,
  mermaidInitialize,
  mermaidRender,
  mockCodeMirrorDispatch,
  mockOpenNewDetachedFileExplorerWindow,
  mockPushErrorToast,
  FileViewPanel,
  resolveEditorAnnotationWidgetOrder,
  clearFileDocumentSessionCacheForTests,
  getCodeIntelDefinition,
  getCodeIntelImplementations,
  getCodeIntelReferences,
  getGitFileFullDiff,
  prepareCodeIntel,
  readLocalImageDataUrl,
  readExternalAbsoluteFile,
  readExternalSpecFile,
  readWorkspaceFile,
  writeExternalSpecFile,
  writeWorkspaceFile,
  loadKatexAssets,
  useFilePreviewPayload,
  getFileTreeIconSvg,
  openFileContentContextMenu,
  clickFileContextMenuItem,
  toggleFileGitBlame,
};
