import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Puzzle from "lucide-react/dist/esm/icons/puzzle";
import {
  matchViewerPlugin,
  useInstalledPlugins,
} from "../installedPluginsStore";
import { requestPluginHtmlPreview } from "../pluginPreviewBus";
import type { InstalledPlugin } from "../types";
import "../../../styles/plugin-preview.css";

// ```ccgui-preview 围栏的 JSON 载荷：插件在回复里主动声明产物，
// 与文件名/写盘方式解耦——这是比 viewer.filePattern 更可靠的显式触发器。
interface PluginPreviewPayload {
  file: string;
  plugin?: string;
  title?: string;
}

function parsePayload(raw: string): PluginPreviewPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const file = (parsed as { file?: unknown }).file;
    if (typeof file !== "string" || !file.trim()) {
      return null;
    }
    const plugin = (parsed as { plugin?: unknown }).plugin;
    const title = (parsed as { title?: unknown }).title;
    return {
      file: file.trim(),
      plugin: typeof plugin === "string" ? plugin : undefined,
      title: typeof title === "string" ? title : undefined,
    };
  } catch {
    return null;
  }
}

function resolvePlugin(
  plugins: InstalledPlugin[],
  payload: PluginPreviewPayload,
): InstalledPlugin | null {
  if (payload.plugin) {
    const byId = plugins.find(
      (plugin) =>
        plugin.manifest.id === payload.plugin &&
        plugin.manifest.capabilities.viewer?.action === "html-preview",
    );
    if (byId) {
      return byId;
    }
  }
  return matchViewerPlugin(plugins, payload.file);
}

interface PluginPreviewEntryProps {
  value: string;
}

/**
 * PluginPreviewEntry — 渲染 ```ccgui-preview 围栏为预览入口卡。
 * 载荷非法或没有可服务的已安装插件时，回退为普通代码块展示。
 */
export function PluginPreviewEntry({ value }: PluginPreviewEntryProps) {
  const { t } = useTranslation();
  const installedPlugins = useInstalledPlugins();
  const payload = useMemo(() => parsePayload(value), [value]);
  const plugin = useMemo(
    () => (payload ? resolvePlugin(installedPlugins, payload) : null),
    [installedPlugins, payload],
  );

  if (!payload || !plugin) {
    return (
      <pre className="markdown-codeblock">
        <code>{value}</code>
      </pre>
    );
  }

  const fileName = payload.file.split("/").pop() ?? payload.file;
  return (
    <div className="plugin-preview-entry">
      <Puzzle size={14} className="plugin-preview-entry-icon" aria-hidden />
      <div className="plugin-preview-entry-meta">
        <span className="plugin-preview-entry-title">
          {payload.title || fileName}
        </span>
        <span className="plugin-preview-entry-plugin">
          {plugin.manifest.name}
        </span>
      </div>
      <button
        type="button"
        className="plugin-preview-entry-button"
        onClick={() =>
          requestPluginHtmlPreview({
            filePath: payload.file,
            pluginId: plugin.manifest.id,
            pluginName: plugin.manifest.name,
            pattern: plugin.manifest.capabilities.viewer?.filePattern ?? "",
          })
        }
      >
        {t("pluginsPage.previewButton")}
      </button>
    </div>
  );
}
