// 宿主能力面 —— 插件与 CC GUI 交互的官方稳定入口。
//
// 刻意「精选」：不直接暴露 window / Tauri invoke。给插件稳定 API，
// 宿主内部重构不破坏插件（即便同上下文技术上能碰内部，也鼓励只用 App）。

import type { Notice } from "./ui";

/** 工作区 / 会话上下文（只读快照）。 */
export interface Workspace {
  /** 当前激活会话 ID；无则 null。 */
  readonly activeThreadId: string | null;
  /** 当前工作区根路径；无则 null。 */
  readonly currentWorkspacePath: string | null;
}

/** 受控文件访问（复用宿主的路径逃逸防护，只允许工作区内）。 */
export interface FileSystem {
  /** 读取工作区内某文件的文本内容；越界 / 超限抛错。 */
  readWorkspaceFile(path: string): Promise<string>;
}

export interface App {
  readonly workspace: Workspace;
  readonly files: FileSystem;
  /** 弹一条轻提示（接宿主 toast）；返回句柄可后续更新 / 关闭。 */
  notice(message: string, timeoutMs?: number): Notice;
}
