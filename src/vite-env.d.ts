/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 调试期本地插件包目录（.env.local 注入，不入库）；未设置时官方插件走 repository 远程安装 */
  readonly VITE_PLUGIN_DEMOS_DIR?: string;
}

declare const __APP_VERSION__: string;

// Window extensions for ChatInputBox Java bridge interop (idea-claude compatibility)
interface Window {
  __MOSSX_WEB_SERVICE__?: boolean;
  handleFilePathFromJava?: (filePathInput: string | string[]) => void;
  insertCodeSnippetAtCursor?: (selectionInfo: string) => void;
  updateAgents?: (json: string) => void;
  onFileListResult?: (json: string) => void;
  updatePrompts?: (json: string) => void;
  updateSlashCommands?: (json: string) => void;
  __pendingSlashCommands?: string;
  sendToJava?: (message: string) => void;
  __fileTreeDragPaths?: string[];
  __fileTreeDragStamp?: number;
  __fileTreeDragActive?: boolean;
  __fileTreeDragPosition?: { x: number; y: number };
  __fileTreeDragOverChat?: boolean;
  __fileTreeDragDropped?: boolean;
  __fileTreeDragCleanup?: () => void;
}
