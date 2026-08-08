/**
 * 回合/会话文件变更汇总卡 - 头部「已编辑 N 个文件 + 总增删」，
 * 列表复用文件树彩色图标 + 文件名 + 每文件增删统计。
 * 可选：顶部「撤销全部」与行 hover 单文件「撤销」（均为文字按钮 + 二次确认）。
 *
 * 可见文件列表由上层 summary 决定（Composer run-status 在撤销后按签名过滤）；
 * 本卡不再维护本地 hide state，避免 collapse/remount 后「撤销了还显示」。
 */
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../../../../components/ui/ConfirmDialog";
import { getFileTreeIconSvg } from "../../../files/utils/fileTreeIcons";
import {
  areTurnFileChangesSummariesEqual,
  type TurnFileChangesSummary,
} from "../../utils/turnFileChanges";
import { getFileName } from "../toolBlocks/toolConstants";

const COLLAPSED_FILE_COUNT = 4;

interface TurnFilesChangedCardProps {
  summary: TurnFileChangesSummary;
  onPreviewFileDiff?: (path: string) => void;
  /** 撤销单个文件的本地改动（git restore） */
  onRevertFile?: (path: string) => void | Promise<void>;
  /** 撤销列表内全部文件的本地改动；入参为当前可见文件路径 */
  onRevertAll?: (paths: string[]) => void | Promise<void>;
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
  function TurnFilesChangedCard({
    summary,
    onPreviewFileDiff,
    onRevertFile,
    onRevertAll,
  }: TurnFilesChangedCardProps) {
    const { t } = useTranslation();
    const [showAll, setShowAll] = useState(false);
    const [confirmRevertAllOpen, setConfirmRevertAllOpen] = useState(false);
    /** 待二次确认的单文件路径；null 表示未打开确认框 */
    const [pendingRevertFilePath, setPendingRevertFilePath] = useState<
      string | null
    >(null);
    const [isReverting, setIsReverting] = useState(false);

    if (summary.files.length === 0) {
      return null;
    }

    const visibleFiles = summary.files;
    const displayedFiles = showAll
      ? visibleFiles
      : visibleFiles.slice(0, COLLAPSED_FILE_COUNT);
    const hiddenCount = visibleFiles.length - displayedFiles.length;
    const showRevertAll = Boolean(onRevertAll) && visibleFiles.length > 0;

    const handleConfirmRevertFile = async () => {
      if (!onRevertFile || isReverting || !pendingRevertFilePath) return;
      const path = pendingRevertFilePath;
      setIsReverting(true);
      try {
        await onRevertFile(path);
        setPendingRevertFilePath(null);
      } finally {
        setIsReverting(false);
      }
    };

    const handleConfirmRevertAll = async () => {
      if (!onRevertAll || isReverting) return;
      const paths = visibleFiles.map((f) => f.path);
      if (paths.length === 0) {
        setConfirmRevertAllOpen(false);
        return;
      }
      setIsReverting(true);
      try {
        await onRevertAll(paths);
        setConfirmRevertAllOpen(false);
      } finally {
        setIsReverting(false);
      }
    };

    const pendingRevertFileName = pendingRevertFilePath
      ? getFileName(pendingRevertFilePath) || pendingRevertFilePath
      : "";

    return (
      <div className="turn-files-changed-card my-2 overflow-hidden rounded-lg border border-border bg-background text-[13px] font-normal leading-5 [&_button]:font-normal">
        {/* 紧凑头：固定 h-8；下边框分隔列表；run-status 面板内 sticky 不随滚动 */}
        <div className="turn-files-changed-card__header flex h-8 items-center justify-between gap-2 border-b border-border px-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-muted-foreground">
              {t("messages.turnFilesChanged.title", {
                count: visibleFiles.length,
              })}
            </span>
            <DiffStat
              additions={summary.totalAdditions}
              deletions={summary.totalDeletions}
              className="text-xs leading-none"
            />
          </div>
          {showRevertAll ? (
            <button
              type="button"
              data-testid="turn-files-changed-revert-all"
              className={cn(
                // 显式 p/h 覆盖全局 button { padding: 8px 14px }；纯文字、无图标
                "inline-flex h-6 shrink-0 items-center rounded-md px-1.5 py-0 text-xs font-medium leading-none",
                "text-destructive hover:bg-destructive/10",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              disabled={isReverting}
              title={t("messages.turnFilesChanged.revertAll")}
              aria-label={t("messages.turnFilesChanged.revertAll")}
              onClick={(event) => {
                event.stopPropagation();
                setPendingRevertFilePath(null);
                setConfirmRevertAllOpen(true);
              }}
            >
              {t("messages.turnFilesChanged.revertAll")}
            </button>
          ) : null}
        </div>
        <div className="pb-0.5">
          {displayedFiles.map((file) => {
            const fileName = getFileName(file.path) || file.path;
            // 紧凑行：左侧 icon+文件名；右侧固定槽位默认 stats，hover 时槽位内切换为「撤销」
            // （不 absolute 浮动，直接占红框对应的 stats 列）
            const rowClass = cn(
              "group/file turn-files-changed-card__row flex h-7 w-full items-center gap-2 px-2.5 text-left transition-colors",
              "hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none",
            );

            const fileIdentity = (
              <>
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
              </>
            );

            // 右侧槽：默认 diff 统计；有撤销能力时 hover/focus 替换为文字「撤销」
            const trailingSlot = (
              <span className="ml-auto flex h-6 shrink-0 items-center justify-end">
                <DiffStat
                  additions={file.additions}
                  deletions={file.deletions}
                  className={cn(
                    "text-xs leading-none",
                    onRevertFile &&
                      "group-hover/file:hidden group-focus-within/file:hidden",
                  )}
                />
                {onRevertFile ? (
                  <button
                    type="button"
                    data-testid="turn-files-changed-revert-file"
                    data-path={file.path}
                    className={cn(
                      // 占 stats 同列；默认隐藏，hover 时以 in-flow 显示（非浮动）
                      "hidden h-6 items-center rounded-md px-1.5 py-0 text-xs font-medium leading-none",
                      "text-destructive hover:bg-destructive/10",
                      "group-hover/file:inline-flex group-focus-within/file:inline-flex",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40",
                      "disabled:pointer-events-none disabled:opacity-40",
                    )}
                    disabled={isReverting}
                    title={t("messages.turnFilesChanged.revertFile", {
                      path: fileName,
                    })}
                    aria-label={t("messages.turnFilesChanged.revertFile", {
                      path: fileName,
                    })}
                    onClick={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      setConfirmRevertAllOpen(false);
                      setPendingRevertFilePath(file.path);
                    }}
                  >
                    {t("messages.turnFilesChanged.revertFileAction")}
                  </button>
                ) : null}
              </span>
            );

            return onPreviewFileDiff ? (
              <div key={file.path} className={rowClass} title={file.path}>
                <button
                  type="button"
                  // p-0 必须：否则继承全局 button { padding: 8px 14px } 把行高撑成双倍
                  className="flex h-full min-w-0 flex-1 items-center gap-2 p-0 text-left text-[13px] font-normal leading-5"
                  onClick={() => onPreviewFileDiff(file.path)}
                >
                  {fileIdentity}
                </button>
                {trailingSlot}
              </div>
            ) : (
              <div key={file.path} className={rowClass} title={file.path}>
                {fileIdentity}
                {trailingSlot}
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              className="flex h-7 w-full items-center gap-1 px-2.5 py-0 text-left text-xs font-normal leading-none text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              onClick={() => setShowAll(true)}
            >
              {t("messages.turnFilesChanged.showMore", { count: hiddenCount })}
              <ChevronDown size={12} aria-hidden />
            </button>
          )}
        </div>

        {showRevertAll ? (
          <ConfirmDialog
            open={confirmRevertAllOpen}
            title={t("messages.turnFilesChanged.revertAllConfirmTitle")}
            body={t("messages.turnFilesChanged.revertAllConfirmBody", {
              count: visibleFiles.length,
            })}
            confirmText={t("messages.turnFilesChanged.revertAllConfirmAction")}
            danger
            onCancel={() => {
              if (!isReverting) setConfirmRevertAllOpen(false);
            }}
            onConfirm={() => {
              void handleConfirmRevertAll();
            }}
          />
        ) : null}

        {onRevertFile ? (
          <ConfirmDialog
            open={pendingRevertFilePath != null}
            title={t("messages.turnFilesChanged.revertFileConfirmTitle")}
            body={t("messages.turnFilesChanged.revertFileConfirmBody", {
              path: pendingRevertFileName,
            })}
            confirmText={t(
              "messages.turnFilesChanged.revertFileConfirmAction",
            )}
            danger
            onCancel={() => {
              if (!isReverting) setPendingRevertFilePath(null);
            }}
            onConfirm={() => {
              void handleConfirmRevertFile();
            }}
          />
        ) : null}
      </div>
    );
  },
  (prev, next) =>
    areTurnFileChangesSummariesEqual(prev.summary, next.summary) &&
    prev.onPreviewFileDiff === next.onPreviewFileDiff &&
    prev.onRevertFile === next.onRevertFile &&
    prev.onRevertAll === next.onRevertAll,
);

export default TurnFilesChangedCard;
