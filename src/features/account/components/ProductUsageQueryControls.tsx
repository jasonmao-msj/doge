import CalendarDays from "lucide-react/dist/esm/icons/calendar-days";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  useAccountExperienceCopyV1,
  useAccountExperienceLocaleV1,
} from "../hooks/useAccountExperienceCopy";
import type {
  ProductUsageGranularityV1,
  ProductUsageQueryV1,
} from "../runtime/productAccountDetailsClient";

export type ProductUsageQueryControlsProps = {
  readonly query: ProductUsageQueryV1;
  readonly onChange: (query: ProductUsageQueryV1) => void;
};

type UsageDatePreset = {
  readonly id: string;
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
};

export function ProductUsageQueryControls({
  query,
  onChange,
}: ProductUsageQueryControlsProps) {
  const copy = useAccountExperienceCopyV1();
  const locale = useAccountExperienceLocaleV1();
  const presets = useMemo(() => createUsageDatePresets(copy), [copy]);
  const activePreset = presets.find(
    (preset) => preset.startDate === query.startDate && preset.endDate === query.endDate,
  );
  const [open, setOpen] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState(query.startDate);
  const [draftEndDate, setDraftEndDate] = useState(query.endDate);
  const today = formatLocalDate(new Date());
  const draftRangeDays = rangeDays(draftStartDate, draftEndDate);
  const selectedRangeDays = rangeDays(query.startDate, query.endDate);
  const validDraft = draftRangeDays !== null && draftRangeDays <= 365;

  const updateOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftStartDate(query.startDate);
      setDraftEndDate(query.endDate);
    }
    setOpen(nextOpen);
  };

  const applyRange = () => {
    if (!validDraft) return;
    onChange({
      startDate: draftStartDate,
      endDate: draftEndDate,
      granularity: recommendedGranularity(draftRangeDays, query.granularity),
    });
    setOpen(false);
  };

  const setGranularity = (value: string) => {
    if (value !== "day" && value !== "hour") return;
    if (value === "hour" && selectedRangeDays !== null && selectedRangeDays > 31) return;
    onChange({ ...query, granularity: value });
  };

  return (
    <div className="account-usage-query-controls">
      <span className="account-usage-query-control">
        <span>{copy.accountUsageTimeRange}</span>
        <Popover open={open} onOpenChange={updateOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="account-usage-range-trigger"
              aria-label={copy.accountUsageTimeRange}
            >
              <CalendarDays aria-hidden />
              <span>
                {activePreset?.label ?? formatRange(query.startDate, query.endDate, locale)}
              </span>
              <ChevronDown aria-hidden data-open={open ? "true" : "false"} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="account-usage-range-popover"
          >
            <div className="account-usage-range-presets">
              {presets.map((preset) => {
                const selected = preset.startDate === draftStartDate &&
                  preset.endDate === draftEndDate;
                return (
                  <button
                    type="button"
                    key={preset.id}
                    data-selected={selected ? "true" : "false"}
                    onClick={() => {
                      setDraftStartDate(preset.startDate);
                      setDraftEndDate(preset.endDate);
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div className="account-usage-range-custom">
              <label>
                <span>{copy.accountUsageStartDate}</span>
                <input
                  type="date"
                  value={draftStartDate}
                  max={draftEndDate || today}
                  onChange={(event) => setDraftStartDate(event.currentTarget.value)}
                />
              </label>
              <i aria-hidden>→</i>
              <label>
                <span>{copy.accountUsageEndDate}</span>
                <input
                  type="date"
                  value={draftEndDate}
                  min={draftStartDate}
                  max={today}
                  onChange={(event) => setDraftEndDate(event.currentTarget.value)}
                />
              </label>
            </div>
            <div className="account-usage-range-actions">
              <button type="button" disabled={!validDraft} onClick={applyRange}>
                {copy.accountUsageApplyRange}
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </span>

      <span className="account-usage-query-control">
        <span>{copy.accountUsageGranularity}</span>
        <Select value={query.granularity} onValueChange={setGranularity}>
          <SelectTrigger
            size="sm"
            className="account-usage-granularity-trigger"
            aria-label={copy.accountUsageGranularity}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false} align="end">
            <SelectItem value="day">{copy.accountUsageGranularityDay}</SelectItem>
            <SelectItem
              value="hour"
              disabled={selectedRangeDays !== null && selectedRangeDays > 31}
            >
              {copy.accountUsageGranularityHour}
            </SelectItem>
          </SelectPopup>
        </Select>
      </span>
    </div>
  );
}

function createUsageDatePresets(
  copy: ReturnType<typeof useAccountExperienceCopyV1>,
): readonly UsageDatePreset[] {
  const today = startOfLocalDay(new Date());
  const yesterday = shiftDays(today, -1);
  const last24HoursStart = startOfLocalDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  return [
    preset("today", copy.accountUsageRangeToday, today, today),
    preset("yesterday", copy.accountUsageRangeYesterday, yesterday, yesterday),
    preset("last24Hours", copy.accountUsageRangeLast24Hours, last24HoursStart, today),
    preset("last7Days", copy.accountUsageRangeLast7Days, shiftDays(today, -6), today),
    preset("last14Days", copy.accountUsageRangeLast14Days, shiftDays(today, -13), today),
    preset("last30Days", copy.accountUsageRangeLast30Days, shiftDays(today, -29), today),
    preset("thisMonth", copy.accountUsageRangeThisMonth, thisMonthStart, today),
    preset("lastMonth", copy.accountUsageRangeLastMonth, lastMonthStart, lastMonthEnd),
  ];
}

function preset(
  id: string,
  label: string,
  start: Date,
  end: Date,
): UsageDatePreset {
  return { id, label, startDate: formatLocalDate(start), endDate: formatLocalDate(end) };
}

function recommendedGranularity(
  days: number | null,
  current: ProductUsageGranularityV1,
): ProductUsageGranularityV1 {
  if (days === null) return current;
  if (days <= 1) return "hour";
  return days > 31 ? "day" : current;
}

function rangeDays(startDate: string, endDate: string): number | null {
  const start = Date.parse(`${startDate}T00:00:00`);
  const end = Date.parse(`${endDate}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

function formatRange(startDate: string, endDate: string, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" });
  const start = formatter.format(new Date(`${startDate}T00:00:00`));
  const end = formatter.format(new Date(`${endDate}T00:00:00`));
  return startDate === endDate ? start : `${start} – ${end}`;
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function shiftDays(value: Date, days: number): Date {
  const shifted = new Date(value);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
