import { useSyncExternalStore } from "react";
import { listInstalledPlugins } from "../../services/tauri/plugins";
import type { InstalledPlugin } from "./types";

// 已安装插件是低频数据：启动后首个订阅者触发一次拉取，之后仅由
// 安装/卸载动作调用 refreshInstalledPlugins 主动刷新，无任何轮询。
export const INSTALLED_PLUGINS_UPDATED_EVENT = "ccgui:installed-plugins-updated";

const EMPTY_PLUGINS: InstalledPlugin[] = [];

let cachedPlugins: InstalledPlugin[] = EMPTY_PLUGINS;
let hasStartedInitialLoad = false;
const subscribers = new Set<() => void>();

// 用「id@version#skillLinked」签名判断列表是否变化：覆盖增删、版本升级与软链
// 状态翻转（UI 实际渲染依赖的字段），比全量 JSON.stringify 更轻且意图明确。
// 同 id 同 version 的内容变更需升 version 才会触发刷新（符合 semver 约定）。
function pluginsSignature(plugins: InstalledPlugin[]): string {
  return plugins
    .map(
      (plugin) =>
        `${plugin.manifest.id}@${plugin.manifest.version}#${plugin.skillLinked ? 1 : 0}`,
    )
    .join(",");
}

function notifySubscribers(): void {
  for (const subscriber of subscribers) {
    subscriber();
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(INSTALLED_PLUGINS_UPDATED_EVENT));
  }
}

export async function refreshInstalledPlugins(): Promise<InstalledPlugin[]> {
  try {
    const raw = await listInstalledPlugins();
    // 后端异常/测试桩可能给出非数组，归一化为空列表防止消费端崩溃。
    const next = Array.isArray(raw) ? raw : EMPTY_PLUGINS;
    if (pluginsSignature(cachedPlugins) !== pluginsSignature(next)) {
      cachedPlugins = next;
      notifySubscribers();
    }
    return cachedPlugins;
  } catch (error) {
    console.warn("Failed to refresh installed plugins:", error);
    return cachedPlugins;
  }
}

function ensureInitialLoad(): void {
  if (hasStartedInitialLoad) {
    return;
  }
  hasStartedInitialLoad = true;
  void refreshInstalledPlugins();
}

function subscribe(onStoreChange: () => void): () => void {
  subscribers.add(onStoreChange);
  ensureInitialLoad();
  return () => {
    subscribers.delete(onStoreChange);
  };
}

function getSnapshot(): InstalledPlugin[] {
  return cachedPlugins;
}

export function useInstalledPlugins(): InstalledPlugin[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getInstalledPluginsSnapshot(): InstalledPlugin[] {
  return cachedPlugins;
}

// 判断文件路径是否命中某个已安装插件的 viewer capability。
// v1 支持的 pattern 形态：`**/ *.suffix`（后缀匹配，写法去掉空格）与精确文件名。
export function matchViewerPlugin(
  plugins: InstalledPlugin[],
  filePath: string,
): InstalledPlugin | null {
  const normalizedPath = filePath.replace(/\\/g, "/");
  for (const plugin of plugins) {
    const viewer = plugin.manifest.capabilities.viewer;
    if (!viewer || viewer.action !== "html-preview") {
      continue;
    }
    if (matchesFilePattern(viewer.filePattern, normalizedPath)) {
      return plugin;
    }
  }
  return null;
}

function matchesFilePattern(pattern: string, normalizedPath: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("**/*")) {
    const suffix = trimmed.slice("**/*".length);
    return suffix.length > 0 && normalizedPath.endsWith(suffix);
  }
  const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
  return baseName === trimmed;
}
