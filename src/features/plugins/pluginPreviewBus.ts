import { useSyncExternalStore } from "react";

// 消息层（TurnFilesChangedCard）与布局层（右侧面板）相距很远，
// 走 props 需要穿透十余层高频渲染组件；这里用事件总线 + 外部 store
// 解耦：请求只在用户点击时发生，target 变更只影响预览面板自身。
export interface PluginHtmlPreviewRequest {
  /** workspace 相对路径 */
  filePath: string;
  pluginId: string;
  pluginName: string;
  pattern: string;
}

const PREVIEW_REQUEST_EVENT = "ccgui:plugin-html-preview-request";

export function requestPluginHtmlPreview(request: PluginHtmlPreviewRequest): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<PluginHtmlPreviewRequest>(PREVIEW_REQUEST_EVENT, { detail: request }),
  );
}

export function subscribePluginHtmlPreviewRequests(
  handler: (request: PluginHtmlPreviewRequest) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PluginHtmlPreviewRequest>).detail;
    if (detail && typeof detail.filePath === "string") {
      handler(detail);
    }
  };
  window.addEventListener(PREVIEW_REQUEST_EVENT, listener);
  return () => {
    window.removeEventListener(PREVIEW_REQUEST_EVENT, listener);
  };
}

let currentTarget: PluginHtmlPreviewRequest | null = null;
const targetSubscribers = new Set<() => void>();

export function setPluginPreviewTarget(target: PluginHtmlPreviewRequest | null): void {
  if (currentTarget === target) {
    return;
  }
  currentTarget = target;
  for (const subscriber of targetSubscribers) {
    subscriber();
  }
}

function subscribeTarget(onStoreChange: () => void): () => void {
  targetSubscribers.add(onStoreChange);
  return () => {
    targetSubscribers.delete(onStoreChange);
  };
}

function getTargetSnapshot(): PluginHtmlPreviewRequest | null {
  return currentTarget;
}

export function usePluginPreviewTarget(): PluginHtmlPreviewRequest | null {
  return useSyncExternalStore(subscribeTarget, getTargetSnapshot, getTargetSnapshot);
}
