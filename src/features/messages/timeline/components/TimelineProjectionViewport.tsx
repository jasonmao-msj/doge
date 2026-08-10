import { Fragment, type ReactNode } from "react";
import type { TimelineProjectionRow } from "../projection/messagesTimelineProjection";

type TimelineProjectionViewportProps = {
  renderProjectionRow: (row: TimelineProjectionRow | undefined) => ReactNode;
  timelineProjectionRows: TimelineProjectionRow[];
};

/**
 * 时间线投影视口 —— 始终静态全量渲染（对齐 reference desktop client，无列表虚拟化）。
 * 虚拟化曾与幕布 stick-to-bottom 抢 scrollTop / 估高回填，导致流式卡中部与跳底；
 * 2026-08 起彻底移除 TanStack Virtual 路径。
 */
export function TimelineProjectionViewport({
  renderProjectionRow,
  timelineProjectionRows,
}: TimelineProjectionViewportProps) {
  return timelineProjectionRows.map((row) => (
    <Fragment key={row.key}>{renderProjectionRow(row)}</Fragment>
  ));
}
