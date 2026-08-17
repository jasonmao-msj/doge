import { useEffect, useMemo, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { EngineIcon } from "../../engine/components/EngineIcon";
import type {
  SubscriptionEngineUsageV1,
  SubscriptionUsageDayV1,
  SubscriptionUsageModelV1,
  SubscriptionUsageWindowV1,
} from "../contracts";
import type { AccountExperienceControllerV1 } from "../hooks/useAccountExperienceController";
import {
  useAccountExperienceCopyV1,
  useAccountExperienceLocaleV1,
  type AccountExperienceLocaleV1,
} from "../hooks/useAccountExperienceCopy";

type CalendarCellV1 = {
  readonly date: string;
  readonly inRange: boolean;
  readonly usage: SubscriptionUsageDayV1 | null;
};

type CalendarWeekV1 = {
  readonly key: string;
  readonly monthLabel: string | null;
  readonly cells: readonly CalendarCellV1[];
};

export function AccountUsagePanel({
  controller,
}: {
  readonly controller: AccountExperienceControllerV1;
}) {
  const copy = useAccountExperienceCopyV1();
  const locale = useAccountExperienceLocaleV1();
  const usage = controller.usage;
  const engines = useMemo(
    () => (usage?.status === "available" ? usage.engines : []),
    [usage],
  );
  const [selectedEngineId, setSelectedEngineId] = useState<string | null>(null);

  useEffect(() => {
    if (engines.length === 0) {
      setSelectedEngineId(null);
      return;
    }
    if (!engines.some((engine) => engine.engineId === selectedEngineId)) {
      setSelectedEngineId(engines[0]?.engineId ?? null);
    }
  }, [engines, selectedEngineId]);

  const selectedEngine = engines.find((engine) => engine.engineId === selectedEngineId)
    ?? engines[0]
    ?? null;

  return (
    <div className="account-usage-panel">
      {usage?.status === "available" && selectedEngine ? (
        <>
          <div
            className="account-usage-engine-list"
            data-columns={Math.min(engines.length, 3)}
            aria-label={copy.gateMyEngines}
          >
            {engines.map((engine) => (
              <EngineSummaryCard
                key={engine.engineId}
                engine={engine}
                locale={locale}
                selected={engine.engineId === selectedEngine.engineId}
                onSelect={() => setSelectedEngineId(engine.engineId)}
              />
            ))}
          </div>
          <EngineUsageDetail engine={selectedEngine} controller={controller} locale={locale} />
        </>
      ) : usage ? (
        <p className="account-empty-state">{copy.usageUnavailable}</p>
      ) : (
        <p className="account-empty-state">{copy.usageEmpty}</p>
      )}
    </div>
  );
}

function EngineSummaryCard({
  engine,
  locale,
  selected,
  onSelect,
}: {
  readonly engine: SubscriptionEngineUsageV1;
  readonly locale: AccountExperienceLocaleV1;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const copy = useAccountExperienceCopyV1();
  const primaryWindow = ([
    [copy.usageToday, engine.windows.daily],
    [copy.usageWeek, engine.windows.weekly],
    [copy.usageMonth, engine.windows.monthly],
  ] as const).find((entry) => entry[1] !== null) ?? null;
  return (
    <button
      type="button"
      className="account-usage-engine-card"
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="account-usage-engine-heading">
        <span className="account-usage-engine-icon">
          <EngineIcon engine={engine.engineId === "claude-code" ? "claude" : "codex"} size={20} />
        </span>
        <span>
          <strong>{engine.engineLabel}</strong>
          <small>{engine.subscriptionLabel}</small>
        </span>
      </span>
      {primaryWindow?.[1] ? (
        <span className="account-usage-window-compact">
          <small>{primaryWindow[0]}</small>
          <strong>{formatMoney(primaryWindow[1].used.value, locale)} / {formatMoney(primaryWindow[1].limit.value, locale)}</strong>
        </span>
      ) : null}
      {engine.expiresAt ? (
        <span className="account-usage-expiry">
          {copy.usageExpiresAt} · {formatDate(engine.expiresAt, locale)}
        </span>
      ) : null}
    </button>
  );
}

function EngineUsageDetail({
  engine,
  controller,
  locale,
}: {
  readonly engine: SubscriptionEngineUsageV1;
  readonly controller: AccountExperienceControllerV1;
  readonly locale: AccountExperienceLocaleV1;
}) {
  const copy = useAccountExperienceCopyV1();
  const windows = [
    [copy.usageToday, engine.windows.daily],
    [copy.usageWeek, engine.windows.weekly],
    [copy.usageMonth, engine.windows.monthly],
  ] as const;
  const range = controller.usage?.range;
  return (
    <section className="account-usage-engine-detail" aria-label={`${engine.engineLabel} ${copy.usage}`}>
      <div className="account-usage-window-grid">
        {windows.map(([label, window]) => window ? (
          <UsageWindowCard key={label} label={label} window={window} locale={locale} />
        ) : null)}
      </div>

      {engine.analyticsStatus === "available" && range ? (
        <>
          <div className="account-usage-chart-heading">
            <strong>{copy.usageLastYear}</strong>
            <span>
              {copy.usageRequests} {formatCount(engine.totals.requests, locale)} · {copy.usageTokens} {formatCompact(engine.totals.totalTokens, locale)} · {formatMoney(engine.totals.actualCost.value, locale)}
            </span>
          </div>
          <UsageHeatmap
            engine={engine}
            startDate={range.startDate}
            endDate={range.endDate}
            controller={controller}
            locale={locale}
          />
          {engine.models.length > 0 ? (
            <details className="account-usage-model-summary">
              <summary>{copy.usageModels}</summary>
              <ModelUsageList models={engine.models} locale={locale} />
            </details>
          ) : null}
        </>
      ) : (
        <p className="account-empty-state">{copy.usageAnalyticsUnavailable}</p>
      )}
    </section>
  );
}

function UsageWindowCard({
  label,
  window,
  locale,
}: {
  readonly label: string;
  readonly window: SubscriptionUsageWindowV1;
  readonly locale: AccountExperienceLocaleV1;
}) {
  const copy = useAccountExperienceCopyV1();
  const percentage = Math.min(100, Math.max(0, Number(window.percentage) || 0));
  return (
    <article className="account-usage-window-card">
      <div className="account-usage-window-title">
        <strong>{label}</strong>
        <span>{formatMoney(window.remaining.value, locale)}</span>
      </div>
      <div className="account-usage-progress" aria-label={`${label} ${percentage}%`}>
        <span style={{ width: `${percentage}%` }} />
      </div>
      <dl>
        <div><dt>{copy.used}</dt><dd>{formatMoney(window.used.value, locale)}</dd></div>
        <div><dt>{copy.usageTotal}</dt><dd>{formatMoney(window.limit.value, locale)}</dd></div>
        <div><dt>{copy.resetsAt}</dt><dd>{formatDateTime(window.resetsAt, locale)}</dd></div>
      </dl>
    </article>
  );
}

function UsageHeatmap({
  engine,
  startDate,
  endDate,
  controller,
  locale,
}: {
  readonly engine: SubscriptionEngineUsageV1;
  readonly startDate: string;
  readonly endDate: string;
  readonly controller: AccountExperienceControllerV1;
  readonly locale: AccountExperienceLocaleV1;
}) {
  const weeks = useMemo(
    () => buildCalendarWeeks(startDate, endDate, engine.days, locale),
    [endDate, engine.days, locale, startDate],
  );
  const weekdayLabels = useMemo(() => buildWeekdayLabels(locale), [locale]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scrollOwner = scrollRef.current;
    if (scrollOwner) scrollOwner.scrollLeft = scrollOwner.scrollWidth;
  }, [endDate, engine.engineId, startDate, weeks.length]);

  return (
    <div className="account-usage-heatmap-shell">
      <div className="account-usage-heatmap-scroll" ref={scrollRef}>
        <div className="account-usage-heatmap-months" style={{ gridTemplateColumns: `repeat(${weeks.length}, 13px)` }} aria-hidden>
          {weeks.map((week) => <span key={week.key}>{week.monthLabel ?? ""}</span>)}
        </div>
        <div className="account-usage-heatmap-body">
          <div className="account-usage-weekdays" aria-hidden>
            {weekdayLabels.map((label, index) => <span key={`${label}-${index}`}>{index % 2 === 1 ? label : ""}</span>)}
          </div>
          <div className="account-usage-heatmap" style={{ gridTemplateColumns: `repeat(${weeks.length}, 11px)` }}>
            {weeks.flatMap((week) => week.cells.map((cell) => (
              <UsageDayCell
                key={`${week.key}:${cell.date}`}
                cell={cell}
                engine={engine}
                controller={controller}
                locale={locale}
              />
            )))}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageDayCell({
  cell,
  engine,
  controller,
  locale,
}: {
  readonly cell: CalendarCellV1;
  readonly engine: SubscriptionEngineUsageV1;
  readonly controller: AccountExperienceControllerV1;
  readonly locale: AccountExperienceLocaleV1;
}) {
  const copy = useAccountExperienceCopyV1();
  if (!cell.inRange) return <span className="account-usage-day account-usage-day--outside" aria-hidden />;
  const usage = cell.usage ?? emptyUsageDay(cell.date);
  const cacheKey = `${engine.engineId}:${cell.date}`;
  const detail = controller.usageDayModelsByKey[cacheKey];
  const loading = controller.usageDayModelsLoadingKeys.has(cacheKey);
  const failed = controller.usageDayModelsFailedKeys.has(cacheKey);
  const hasActivity = usage.requests > 0 || Number(usage.actualCost.value) > 0 || usage.totalTokens > 0;
  const loadModels = () => {
    if (hasActivity) void controller.loadUsageDayModels(engine.engineId, cell.date);
  };
  const accessibleLabel = `${formatDate(cell.date, locale)}, ${copy.usageActualCost} ${formatMoney(usage.actualCost.value, locale)}, ${copy.usageRequests} ${formatCount(usage.requests, locale)}, ${copy.usageTokens} ${formatCount(usage.totalTokens, locale)}`;
  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="account-usage-day"
          data-date={cell.date}
          data-level={usage.intensity}
          aria-label={accessibleLabel}
          onPointerEnter={loadModels}
          onFocus={loadModels}
        />
      </TooltipTrigger>
      <TooltipContent className="account-usage-day-tooltip" side="top" sideOffset={8}>
        <strong>{formatDate(cell.date, locale)}</strong>
        {hasActivity ? (
          <>
            <dl className="account-usage-day-stats">
              <div><dt>{copy.usageActualCost}</dt><dd>{formatMoney(usage.actualCost.value, locale)}</dd></div>
              <div><dt>{copy.usageStandardCost}</dt><dd>{formatMoney(usage.cost.value, locale)}</dd></div>
              <div><dt>{copy.usageRequests}</dt><dd>{formatCount(usage.requests, locale)}</dd></div>
              <div><dt>{copy.usageTokens}</dt><dd>{formatCompact(usage.totalTokens, locale)}</dd></div>
              <div><dt>{copy.usageInputTokens}</dt><dd>{formatCompact(usage.inputTokens, locale)}</dd></div>
              <div><dt>{copy.usageOutputTokens}</dt><dd>{formatCompact(usage.outputTokens, locale)}</dd></div>
              <div><dt>{copy.usageCacheTokens}</dt><dd>{formatCompact(usage.cacheReadTokens + usage.cacheWriteTokens, locale)}</dd></div>
            </dl>
            <div className="account-usage-day-models">
              {loading ? <span>{copy.usageModelsLoading}</span> : null}
              {failed ? <span>{copy.usageModelsUnavailable}</span> : null}
              {detail?.models.length ? <ModelUsageList models={detail.models} compact locale={locale} /> : null}
            </div>
          </>
        ) : <span className="account-usage-day-empty">{copy.usageNoActivity}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

function ModelUsageList({
  models,
  locale,
  compact = false,
}: {
  readonly models: readonly SubscriptionUsageModelV1[];
  readonly locale: AccountExperienceLocaleV1;
  readonly compact?: boolean;
}) {
  const copy = useAccountExperienceCopyV1();
  return (
    <div className="account-usage-model-list" data-compact={compact ? "true" : "false"}>
      {models.slice(0, compact ? 8 : 12).map((model) => (
        <div key={model.modelLabel}>
          <strong>{model.modelLabel}</strong>
          <span>{formatMoney(model.actualCost.value, locale)} · {formatCompact(model.totalTokens, locale)} {copy.usageTokens} · {formatCount(model.requests, locale)} {copy.usageRequests}</span>
        </div>
      ))}
    </div>
  );
}

function buildCalendarWeeks(
  startDate: string,
  endDate: string,
  usageDays: readonly SubscriptionUsageDayV1[],
  locale: AccountExperienceLocaleV1,
): readonly CalendarWeekV1[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end || start > end) return [];
  const usageByDate = new Map(usageDays.map((day) => [day.date, day]));
  const gridStart = new Date(start);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());
  const gridEnd = new Date(end);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));
  const cells: CalendarCellV1[] = [];
  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    cells.push({
      date,
      inRange: cursor >= start && cursor <= end,
      usage: usageByDate.get(date) ?? null,
    });
  }
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const weeks: CalendarWeekV1[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    const weekCells = cells.slice(index, index + 7);
    const monthCell = weekCells.find((cell) => cell.inRange && cell.date.endsWith("-01"));
    weeks.push({
      key: weekCells[0]?.date ?? String(index),
      monthLabel: monthCell ? monthFormatter.format(new Date(`${monthCell.date}T00:00:00Z`)) : null,
      cells: weekCells,
    });
  }
  return weeks;
}

function buildWeekdayLabels(locale: AccountExperienceLocaleV1): readonly string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const sunday = Date.UTC(2026, 7, 16);
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(sunday + index * 86_400_000)));
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function emptyUsageDay(date: string): SubscriptionUsageDayV1 {
  return {
    date,
    intensity: 0,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    cost: { value: "0", unit: "usd" },
    actualCost: { value: "0", unit: "usd" },
  };
}

function formatMoney(value: string, locale: AccountExperienceLocaleV1): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

function formatCompact(value: number, locale: AccountExperienceLocaleV1): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatCount(value: number, locale: AccountExperienceLocaleV1): string {
  return new Intl.NumberFormat(locale).format(value);
}

function formatDate(value: string, locale: AccountExperienceLocaleV1): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

function formatDateTime(value: string, locale: AccountExperienceLocaleV1): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
