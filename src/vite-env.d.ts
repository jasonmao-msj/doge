/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// Window extensions for ChatInputBox Java bridge interop (idea-claude compatibility)
interface Window {
  __DOGE_WEB_SERVICE__?: boolean;
  __MOSSX_WEB_SERVICE__?: boolean;
  handleFilePathFromJava?: (filePathInput: string | string[]) => void;
  insertCodeSnippetAtCursor?: (selectionInfo: string) => void;
  updateAgents?: (json: string) => void;
  onFileListResult?: (json: string) => void;
  sendToJava?: (message: string) => void;
  __fileTreeDragPaths?: string[];
  __fileTreeDragStamp?: number;
  __fileTreeDragActive?: boolean;
  __fileTreeDragPosition?: { x: number; y: number };
  __fileTreeDragOverChat?: boolean;
  __fileTreeDragDropped?: boolean;
  __fileTreeDragCleanup?: () => void;
}
