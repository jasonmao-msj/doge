import { useId, useState } from "react";
import { formatTokenCount } from "../../../utils/tokenFormat";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";
import type { ProductUsageDetailsV1 } from "../runtime/productAccountDetailsClient";

export type ProductUsageTrendChartProps = {
  readonly usage: ProductUsageDetailsV1;
};

const CHART = {
  width: 640,
  height: 276,
  left: 54,
  right: 54,
  top: 22,
  bottom: 34,
} as const;

const SERIES = [
  { key: "inputTokens", color: "#4b86f7", axis: "tokens" },
  { key: "outputTokens", color: "#22b982", axis: "tokens" },
  { key: "cacheCreationTokens", color: "#f59e0b", axis: "tokens" },
  { key: "cacheReadTokens", color: "#18b6cf", axis: "tokens" },
  { key: "cacheHitRate", color: "#8b5cf6", axis: "percent", dashed: true },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

export function ProductUsageTrendChart({ usage }: ProductUsageTrendChartProps) {
  const copy = useAccountExperienceCopyV1();
  const titleId = useId();
  const [hiddenSeries, setHiddenSeries] = useState<ReadonlySet<SeriesKey>>(
    () => new Set(),
  );
  const labels = {
    inputTokens: copy.accountUsageTrendInput,
    outputTokens: copy.accountUsageTrendOutput,
    cacheCreationTokens: copy.accountUsageCacheCreation,
    cacheReadTokens: copy.accountUsageCacheRead,
    cacheHitRate: copy.accountUsageCacheHitRate,
  } as const;
  const toggleSeries = (key: SeriesKey) => {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="account-usage-trend-panel" aria-labelledby={titleId}>
      <div className="account-usage-trend-head">
        <h3 id={titleId}>{copy.accountUsageTokenTrend}</h3>
        <span>
          {usage.query.granularity === "hour"
            ? copy.accountUsageGranularityHour
            : copy.accountUsageGranularityDay}
        </span>
      </div>
      {usage.trendStatus === "available" && usage.trend.length > 0 ? (
        <TrendSvg
          points={usage.trend}
          labels={labels}
          ariaLabel={copy.accountUsageTokenTrend}
          hiddenSeries={hiddenSeries}
          onToggleSeries={toggleSeries}
        />
      ) : (
        <p className="account-usage-trend-empty">
          {usage.trendStatus === "unavailable"
            ? copy.accountUsageTrendUnavailable
            : copy.accountUsageNoActivity}
        </p>
      )}
    </section>
  );
}

function TrendSvg({
  points,
  labels,
  ariaLabel,
  hiddenSeries,
  onToggleSeries,
}: {
  readonly points: ProductUsageDetailsV1["trend"];
  readonly labels: Record<(typeof SERIES)[number]["key"], string>;
  readonly ariaLabel: string;
  readonly hiddenSeries: ReadonlySet<SeriesKey>;
  readonly onToggleSeries: (key: SeriesKey) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const maximum = niceMaximum(Math.max(
    0,
    ...points.flatMap((point) => SERIES
      .filter((series) => series.axis === "tokens" && !hiddenSeries.has(series.key))
      .map((series) => seriesValue(point, series.key))),
  ));
  const xAt = (index: number) => CHART.left +
    (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yAt = (value: number) => CHART.top + plotHeight - (value / maximum) * plotHeight;
  const percentYAt = (value: number) => CHART.top + plotHeight - (value / 100) * plotHeight;
  const xLabelIndexes = uniqueIndexes([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  const showMarkers = points.length <= 62;
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex] ?? null;
  const hoveredX = hoveredIndex === null ? CHART.left : xAt(hoveredIndex);

  return (
    <div className="account-usage-trend-chart" onMouseLeave={() => setHoveredIndex(null)}>
      <div className="account-usage-trend-legend">
        {SERIES.map((series) => (
          <button
            type="button"
            key={series.key}
            data-hidden={hiddenSeries.has(series.key) ? "true" : "false"}
            aria-pressed={!hiddenSeries.has(series.key)}
            onClick={() => onToggleSeries(series.key)}
          >
            <i style={{ backgroundColor: series.color }} />
            {labels[series.key]}
          </button>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={ariaLabel}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maximum * ratio;
          const y = yAt(value);
          return (
            <g key={ratio}>
              <line
                x1={CHART.left}
                x2={CHART.width - CHART.right}
                y1={y}
                y2={y}
                className="account-usage-trend-gridline"
              />
              <text x={CHART.left - 9} y={y + 4} textAnchor="end">
                {formatTokenCount(value)}
              </text>
              <text
                x={CHART.width - CHART.right + 9}
                y={y + 4}
                textAnchor="start"
                className="account-usage-trend-percent-label"
              >
                {`${Math.round(ratio * 100)}%`}
              </text>
            </g>
          );
        })}
        {xLabelIndexes.map((index) => (
          <text
            key={points[index]?.bucket}
            x={xAt(index)}
            y={CHART.height - 8}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
          >
            {formatBucket(points[index]?.bucket ?? "")}
          </text>
        ))}
        {SERIES.filter((series) => !hiddenSeries.has(series.key)).map((series) => {
          const values = points.map((point) => seriesValue(point, series.key));
          const seriesYAt = series.axis === "percent" ? percentYAt : yAt;
          const seriesPoints = values.map((value, index) => ({
            x: xAt(index),
            y: seriesYAt(value),
          }));
          const linePath = smoothLinePath(seriesPoints);
          return (
            <g key={series.key} data-series={series.key}>
            {series.axis === "tokens" ? (
              <path
                d={`${linePath} L ${xAt(points.length - 1)} ${CHART.top + plotHeight} L ${xAt(0)} ${CHART.top + plotHeight} Z`}
                fill={series.color}
                opacity="0.07"
              />
            ) : null}
            <path
              d={linePath}
              fill="none"
              stroke={series.color}
              strokeWidth="2.5"
              strokeDasharray={"dashed" in series && series.dashed ? "7 6" : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {showMarkers ? points.map((point, index) => (
              <circle
                key={`${point.bucket}:${series.key}`}
                cx={xAt(index)}
                cy={seriesYAt(seriesValue(point, series.key))}
                r="3"
                fill="var(--surface-card, #1f2028)"
                stroke={series.color}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              >
                <title>
                  {series.axis === "percent"
                    ? `${point.bucket} · ${labels[series.key]} ${seriesValue(point, series.key).toFixed(1)}%`
                    : `${point.bucket} · ${labels[series.key]} ${formatTokenCount(seriesValue(point, series.key))}`}
                </title>
              </circle>
            )) : null}
            </g>
          );
        })}
        {points.map((point, index) => {
          const previousX = index === 0 ? CHART.left : (xAt(index - 1) + xAt(index)) / 2;
          const nextX = index === points.length - 1
            ? CHART.width - CHART.right
            : (xAt(index) + xAt(index + 1)) / 2;
          return (
            <rect
              key={`hover:${point.bucket}`}
              data-trend-index={index}
              x={previousX}
              y={CHART.top}
              width={Math.max(1, nextX - previousX)}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(index)}
            />
          );
        })}
      </svg>
      {hoveredPoint ? (
        <div
          className="account-usage-trend-tooltip"
          data-align={hoveredX > CHART.width * 0.62 ? "right" : "left"}
          style={{ left: `${(hoveredX / CHART.width) * 100}%` }}
          role="status"
        >
          <strong>{hoveredPoint.bucket}</strong>
          {SERIES.filter((series) => series.axis === "tokens").map((series) => (
            <span key={series.key}>
              <i style={{ borderColor: series.color }} />
              {`${labels[series.key]}: ${formatTokenCount(seriesValue(hoveredPoint, series.key))}`}
            </span>
          ))}
          <b>
            {`Actual: ${formatTrendUsd(hoveredPoint.actualCostUsd)} | Standard: ${formatTrendUsd(hoveredPoint.standardCostUsd)}`}
          </b>
        </div>
      ) : null}
    </div>
  );
}

export function productUsageCacheHitRate(
  point: ProductUsageDetailsV1["trend"][number],
): number {
  const totalPromptTokens = point.inputTokens +
    point.cacheReadTokens +
    point.cacheCreationTokens;
  return totalPromptTokens > 0 ? (point.cacheReadTokens / totalPromptTokens) * 100 : 0;
}

function seriesValue(
  point: ProductUsageDetailsV1["trend"][number],
  key: SeriesKey,
): number {
  return key === "cacheHitRate" ? productUsageCacheHitRate(point) : point[key];
}

function smoothLinePath(points: readonly { x: number; y: number }[]): string {
  const first = points[0];
  if (!first) return "";
  if (points.length === 1) return `M ${first.x} ${first.y}`;
  const commands = [`M ${first.x} ${first.y}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const afterNext = points[index + 2] ?? next;
    const tension = 0.3;
    const control1X = current.x + ((next.x - previous.x) / 6) * tension;
    const control1Y = current.y + ((next.y - previous.y) / 6) * tension;
    const control2X = next.x - ((afterNext.x - current.x) / 6) * tension;
    const control2Y = next.y - ((afterNext.y - current.y) / 6) * tension;
    commands.push(
      `C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${next.x} ${next.y}`,
    );
  }
  return commands.join(" ");
}

function niceMaximum(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function uniqueIndexes(values: readonly number[]): readonly number[] {
  return Array.from(new Set(values.filter((value) => value >= 0)));
}

function formatBucket(value: string): string {
  const normalized = value.replace("T", " ");
  return normalized.length > 10 ? normalized.slice(5, 16) : normalized.slice(5);
}

function formatTrendUsd(value: number): string {
  const digits = value >= 1 ? 2 : value >= 0.01 ? 3 : 4;
  return `$${value.toFixed(digits)}`;
}
