/**
 * 插件 HTML 预览面板 - 右侧面板 filePanelMode="pluginPreview" 分支的渲染体。
 * 从 pluginPreviewBus 的外部 store 读取当前预览目标，经 readWorkspaceFilePreview
 * 读取文件内容（4MB 上限 + 路径逃逸防护），以全禁 sandbox 的 iframe 渲染，
 * 并支持「复制 HTML」（text/html + text/plain 双 MIME，公众号编辑器粘贴保格式）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { readWorkspaceFilePreview } from "../../../services/tauri";
import { usePluginPreviewTarget } from "../pluginPreviewBus";
import "../../../styles/plugin-preview.css";

const COPIED_RESET_DELAY_MS = 2000;

interface HtmlPreviewPanelProps {
  workspaceId: string | null;
}

function getBaseName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").pop() || filePath;
}

async function copyHtmlToClipboard(html: string): Promise<void> {
  if (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([html], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // 富文本剪贴板不可用（权限/平台限制）时回退纯文本
    }
  }
  await navigator.clipboard.writeText(html);
}

export function HtmlPreviewPanel({ workspaceId }: HtmlPreviewPanelProps) {
  const { t } = useTranslation();
  const target = usePluginPreviewTarget();
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const copiedTimerRef = useRef<number | null>(null);

  const filePath = target?.filePath ?? null;

  useEffect(() => {
    setContent(null);
    setLoadError(null);
    if (!workspaceId || !filePath) {
      return;
    }
    let cancelled = false;
    readWorkspaceFilePreview(workspaceId, filePath)
      .then((result) => {
        if (!cancelled) {
          setContent(result.content);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, filePath, reloadKey]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    if (content === null) {
      return;
    }
    try {
      await copyHtmlToClipboard(content);
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, COPIED_RESET_DELAY_MS);
    } catch {
      // 剪贴板整体不可用时静默失败，不打断预览
    }
  }, [content]);

  const handleReload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  if (!target) {
    return (
      <div className="plugin-preview-panel">
        <div className="plugin-preview-empty">{t("pluginsPage.previewTitle")}</div>
      </div>
    );
  }

  const fileName = getBaseName(target.filePath);

  return (
    <div className="plugin-preview-panel">
      <div className="plugin-preview-header">
        <div className="plugin-preview-heading">
          <span className="plugin-preview-title" title={target.filePath}>
            {fileName}
          </span>
          <span className="plugin-preview-trigger">
            {t("pluginsPage.previewTriggerLabel", {
              plugin: target.pluginName,
              pattern: target.pattern,
            })}
          </span>
        </div>
        <div className="plugin-preview-actions">
          <button
            type="button"
            className="plugin-preview-action"
            onClick={handleReload}
            aria-label={t("common.retry")}
            title={t("common.retry")}
          >
            <RefreshCw size={13} aria-hidden />
          </button>
          <button
            type="button"
            className="plugin-preview-action"
            onClick={() => {
              void handleCopy();
            }}
            disabled={content === null}
          >
            {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
            {copied ? t("pluginsPage.copied") : t("pluginsPage.copyHtml")}
          </button>
        </div>
      </div>
      {loadError !== null ? (
        <div className="plugin-preview-error">
          {t("pluginsPage.previewLoadFailed")}: {loadError}
        </div>
      ) : (
        <iframe
          className="plugin-preview-frame"
          srcDoc={content ?? ""}
          sandbox=""
          title={t("pluginsPage.previewTitle")}
        />
      )}
    </div>
  );
}

export default HtmlPreviewPanel;
