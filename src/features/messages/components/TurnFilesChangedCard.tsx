/**
 * 回合文件变更汇总卡 - 渲染在回合完成边界处，或时间线末尾作为会话累计常驻卡。
 * 第一版仅做展示：头部「已编辑 N 个文件 + 总增删」，列表复用文件树彩色图标 +
 * 文件名 + 每文件增删统计，默认收起为前 N 个可展开。撤销/审核入口暂隐藏。
 */
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import { cn } from "@/lib/utils";
import { getFileTreeIconSvg } from "../../files/utils/fileTreeIcons";
import {
  matchViewerPlugin,
  useInstalledPlugins,
} from "../../plugins/installedPluginsStore";
import { requestPluginHtmlPreview } from "../../plugins/pluginPreviewBus";
import {
  areTurnFileChangesSummariesEqual,
  type TurnFileChangesSummary,
} from "../utils/turnFileChanges";
import { getFileName } from "./toolBlocks/toolConstants";

const COLLAPSED_FILE_COUNT = 4;

interface TurnFilesChangedCardProps {
  summary: TurnFileChangesSummary;
}

function DiffStat({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  if (additions <= 0 && deletions <= 0) {
    return null;
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 tabular-nums",
        className,
      )}
    >
      {additions > 0 && (
        <span className="text-emerald-600 dark:text-emerald-400">
          +{additions}
        </span>
      )}
      {deletions > 0 && (
        <span className="text-red-500 dark:text-red-400">-{deletions}</span>
      )}
    </span>
  );
}

export const TurnFilesChangedCard = memo(
  function TurnFilesChangedCard({ summary }: TurnFilesChangedCardProps) {
    const { t } = useTranslation();
    const [showAll, setShowAll] = useState(false);
    // 外部 store（useSyncExternalStore），零后端请求；未装插件时恒为 []。
    const installedPlugins = useInstalledPlugins();

    const { files, totalAdditions, totalDeletions } = summary;
    if (files.length === 0) {
      return null;
    }

    const visibleFiles = showAll ? files : files.slice(0, COLLAPSED_FILE_COUNT);
    const hiddenCount = files.length - visibleFiles.length;

    return (
      <div className="turn-files-changed-card my-2 overflow-hidden rounded-lg border border-border bg-background text-sm font-normal [&_button]:font-normal">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="truncate text-muted-foreground">
            {t("messages.turnFilesChanged.title", { count: files.length })}
          </span>
          <DiffStat
            additions={totalAdditions}
            deletions={totalDeletions}
            className="text-xs"
          />
        </div>
        <div className="pb-1">
          {visibleFiles.map((file) => {
            const fileName = getFileName(file.path) || file.path;
            const viewerPlugin = matchViewerPlugin(installedPlugins, file.path);
            return (
              <div
                key={file.path}
                className="flex w-full items-center gap-2 px-3 py-1"
                title={file.path}
              >
                <span
                  className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4"
                  aria-hidden
                  dangerouslySetInnerHTML={{
                    __html: getFileTreeIconSvg(fileName, false),
                  }}
                />
                <span className="min-w-0 truncate text-foreground">
                  {fileName}
                </span>
                <DiffStat
                  additions={file.additions}
                  deletions={file.deletions}
                  className="ml-auto text-xs"
                />
                {viewerPlugin && (
                  <button
                    type="button"
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      requestPluginHtmlPreview({
                        filePath: file.path,
                        pluginId: viewerPlugin.manifest.id,
                        pluginName: viewerPlugin.manifest.name,
                        pattern:
                          viewerPlugin.manifest.capabilities.viewer
                            ?.filePattern ?? "",
                      });
                    }}
                  >
                    {t("pluginsPage.previewButton")}
                  </button>
                )}
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              className="flex w-full items-center gap-1 px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              onClick={() => setShowAll(true)}
            >
              {t("messages.turnFilesChanged.showMore", { count: hiddenCount })}
              <ChevronDown size={12} aria-hidden />
            </button>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => areTurnFileChangesSummariesEqual(prev.summary, next.summary),
);

export default TurnFilesChangedCard;
