// composer 工具条距 app-shell 的 setAppMode 有十余层 props；
// 「打开插件管理页」这种低频导航动作走事件总线，避免穿透高频渲染链。
const OPEN_PLUGINS_PAGE_EVENT = "ccgui:open-plugins-page";

export function requestOpenPluginsPage(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(OPEN_PLUGINS_PAGE_EVENT));
}

export function subscribeOpenPluginsPageRequests(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener(OPEN_PLUGINS_PAGE_EVENT, handler);
  return () => {
    window.removeEventListener(OPEN_PLUGINS_PAGE_EVENT, handler);
  };
}
