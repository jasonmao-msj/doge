/**
 * 工具块文件类型图标：复用文件树彩色 SVG（TS/JS/…），
 * 让 Read / Edit 行一眼可辨文件类型，与 TurnFilesChangedCard / Git 面板一致。
 */
import { memo, useMemo } from "react";
import { getFileTreeIconSvg } from "@/utils/fileTreeIcons";
import { getFileName } from "./toolConstants";

export type ToolFileTypeIconProps = {
  filePath: string;
  isFolder?: boolean;
  size?: number;
  className?: string;
};

export const ToolFileTypeIcon = memo(function ToolFileTypeIcon({
  filePath,
  isFolder = false,
  size = 14,
  className,
}: ToolFileTypeIconProps) {
  const name = getFileName(filePath) || filePath || (isFolder ? "folder" : "file");
  const html = useMemo(
    () => getFileTreeIconSvg(name, isFolder),
    [isFolder, name],
  );

  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
      // SVG 来自内部可信映射 getFileTreeIconSvg，不含用户 HTML。
      dangerouslySetInnerHTML={{ __html: html }}
      aria-hidden
    />
  );
});

export default ToolFileTypeIcon;
