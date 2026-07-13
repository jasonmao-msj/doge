import { useMemo, useSyncExternalStore } from "react";
import { readPluginGlossary } from "../../services/tauri/plugins";
import {
  INSTALLED_PLUGINS_UPDATED_EVENT,
  getInstalledPluginsSnapshot,
  refreshInstalledPlugins,
} from "./installedPluginsStore";
import {
  buildGlossaryMatcher,
  createGlossaryRehypePlugin,
  lookupGlossaryEntry,
  parseGlossaryDocument,
  type GlossaryEntry,
  type GlossaryMatcher,
  type GlossarySource,
} from "./glossary";
import type { InstalledPlugin } from "./types";

// 词库匹配器是低频数据：首个订阅者触发一次加载，此后仅在
// 已安装插件列表变化事件（安装/卸载）时重建，无任何轮询。
// 没有 glossary 插件时匹配器为 null，渲染链零开销。

let cachedMatcher: GlossaryMatcher | null = null;
let loadedSignature = "";
let hasStartedInitialLoad = false;
let syncGeneration = 0;
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  for (const subscriber of subscribers) {
    subscriber();
  }
}

function glossaryPlugins(plugins: InstalledPlugin[]): InstalledPlugin[] {
  return plugins.filter((plugin) => plugin.manifest.capabilities.glossary);
}

function signatureOf(plugins: InstalledPlugin[]): string {
  return glossaryPlugins(plugins)
    .map((plugin) => `${plugin.manifest.id}@${plugin.manifest.version}`)
    .sort()
    .join(",");
}

async function syncGlossaries(plugins: InstalledPlugin[]): Promise<void> {
  const signature = signatureOf(plugins);
  if (signature === loadedSignature) {
    return;
  }
  const generation = ++syncGeneration;
  const sources: GlossarySource[] = [];
  for (const plugin of glossaryPlugins(plugins)) {
    try {
      const raw = await readPluginGlossary(plugin.manifest.id);
      const document = parseGlossaryDocument(raw);
      if (!document) {
        console.warn(
          `Invalid glossary document in plugin ${plugin.manifest.id}`,
        );
        continue;
      }
      sources.push({
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        document,
      });
    } catch (error) {
      console.warn(
        `Failed to load glossary for plugin ${plugin.manifest.id}:`,
        error,
      );
    }
  }
  // 加载期间又发生了安装/卸载，丢弃过期结果，让新一轮同步落地。
  if (generation !== syncGeneration) {
    return;
  }
  loadedSignature = signature;
  cachedMatcher = buildGlossaryMatcher(sources);
  notifySubscribers();
}

function handlePluginsUpdated(): void {
  void syncGlossaries(getInstalledPluginsSnapshot());
}

function ensureInitialLoad(): void {
  if (hasStartedInitialLoad) {
    return;
  }
  hasStartedInitialLoad = true;
  if (typeof window !== "undefined") {
    window.addEventListener(
      INSTALLED_PLUGINS_UPDATED_EVENT,
      handlePluginsUpdated,
    );
  }
  void refreshInstalledPlugins().then((plugins) => syncGlossaries(plugins));
}

function subscribe(onStoreChange: () => void): () => void {
  subscribers.add(onStoreChange);
  ensureInitialLoad();
  return () => {
    subscribers.delete(onStoreChange);
  };
}

function getSnapshot(): GlossaryMatcher | null {
  return cachedMatcher;
}

export function useGlossaryMatcher(): GlossaryMatcher | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 供消息 Markdown 渲染层使用：无词库时返回 null，不进渲染管线。 */
export function useGlossaryRehypePlugin():
  | (() => (tree: unknown) => void)
  | null {
  const matcher = useGlossaryMatcher();
  return useMemo(
    () => (matcher ? createGlossaryRehypePlugin(matcher) : null),
    [matcher],
  );
}

/** 名词点击时查解释（同步查缓存表，不发请求）。 */
export function getGlossaryEntry(text: string): GlossaryEntry | null {
  return lookupGlossaryEntry(cachedMatcher, text);
}

/** 仅测试使用：注入匹配器并重置加载状态。 */
export function __setGlossaryMatcherForTests(
  matcher: GlossaryMatcher | null,
): void {
  cachedMatcher = matcher;
  loadedSignature = "";
  hasStartedInitialLoad = true;
  notifySubscribers();
}
