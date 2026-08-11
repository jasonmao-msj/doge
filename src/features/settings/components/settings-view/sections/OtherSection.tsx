import { useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  isReactScanFlagEnabled,
  setReactScanEnabled,
} from "@/services/reactScanController";
import {
  isPerfDiagnosticsFlagEnabled,
  setPerfDiagnosticsEnabled,
} from "@/services/perfBaseline/perfDiagnosticsController";
import { buildDiagnosticsReportText } from "@/services/perfBaseline/diagnosticsReport";
import { CuratedSection } from "../../../../curated-skills";
import { HistoryCompletionSettings } from "../../HistoryCompletionSettings";
import { SessionRadarHistoryManagementSection } from "../../SessionRadarHistoryManagementSection";
import type { AppSettings } from "../../../../../types";
import type { SessionRadarEntry } from "../../../../session-activity/hooks/useSessionRadarFeed";
import type { SessionRadarHistoryDeleteResult } from "../../../../session-activity/utils/sessionRadarHistoryManagement";
import {
  readStreamingScheduleTier,
  resetRealtimePerfFlags,
} from "../../../../threads/utils/realtimePerfFlags";
import {
  RENDER_TIER_FLAG_KEY,
  RENDER_SCHEDULE_TIER_VALUES,
  type RenderScheduleTier,
} from "../../../../threads/utils/renderSchedulingPolicy";
import { CostBudgetSettingsSection } from "./CostBudgetSettingsSection";
import { PerfJankLivePanel } from "./PerfJankLivePanel";
import {
  isSharedProjectionDataSourceEnabled,
  setSharedProjectionTestOverrideEnabled,
} from "../../../../messages/presentation/sharedProjection/dataSource";
import {
  isStartupGateOverlayTestEnabled,
  setStartupGateOverlayTestEnabled,
} from "@/features/startup-orchestration/utils/startupGateOverlayTestFlag";

type OtherSectionProps = {
  title: string | null;
  description: string | null;
  appSettings: Pick<AppSettings, "enabledCuratedSkillIds">;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  sessionRadarRecentCompletedSessions: SessionRadarEntry[];
  onDeleteSessionRadarHistory: (
    entries: SessionRadarEntry[],
  ) => Promise<SessionRadarHistoryDeleteResult>;
};

export function OtherSection({
  title,
  description,
  appSettings,
  onUpdateAppSettings,
  sessionRadarRecentCompletedSessions,
  onDeleteSessionRadarHistory,
}: OtherSectionProps) {
  const { t } = useTranslation();
  const [performanceFlagsResetMessage, setPerformanceFlagsResetMessage] =
    useState<string | null>(null);
  const [streamingScheduleTier, setStreamingScheduleTier] =
    useState<RenderScheduleTier>(() => readStreamingScheduleTier());
  const [reactScanEnabled, setReactScanEnabledState] = useState<boolean>(() =>
    isReactScanFlagEnabled(),
  );
  const [perfDiagnosticsEnabled, setPerfDiagnosticsEnabledState] =
    useState<boolean>(() => isPerfDiagnosticsFlagEnabled());
  const [sharedProjectionTestEnabled, setSharedProjectionTestEnabled] =
    useState<boolean>(() => isSharedProjectionDataSourceEnabled());
  const [startupGateOverlayTestEnabled, setStartupGateOverlayTestEnabledState] =
    useState<boolean>(() => isStartupGateOverlayTestEnabled());
  const [copyReportMessage, setCopyReportMessage] = useState<string | null>(
    null,
  );

  const handleReactScanToggle = (checked: boolean) => {
    setReactScanEnabledState(checked);
    void setReactScanEnabled(checked);
  };

  const handlePerfDiagnosticsToggle = (checked: boolean) => {
    setPerfDiagnosticsEnabledState(checked);
    setPerfDiagnosticsEnabled(checked);
  };

  const handleSharedProjectionTestToggle = (checked: boolean) => {
    const changed = setSharedProjectionTestOverrideEnabled(checked);
    setSharedProjectionTestEnabled(isSharedProjectionDataSourceEnabled());
    if (changed) {
      globalThis.location.reload();
    }
  };

  const handleStartupGateOverlayTestToggle = (checked: boolean) => {
    setStartupGateOverlayTestEnabled(checked);
    setStartupGateOverlayTestEnabledState(
      isStartupGateOverlayTestEnabled(),
    );
  };

  const handleCopyPerfReport = async () => {
    const report = buildDiagnosticsReportText();
    try {
      await navigator.clipboard.writeText(report);
      setCopyReportMessage(t("settings.perfCopyReportDone"));
      return;
    } catch {
      // WKWebView 可能拒绝剪贴板写入,降级为下载文本文件。
    }
    try {
      const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `doge-perf-report-${Date.now()}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setCopyReportMessage(t("settings.perfCopyReportDownloaded"));
    } catch {
      setCopyReportMessage(t("settings.perfCopyReportFailed"));
    }
  };

  const handleResetPerformanceFlags = () => {
    const removedKeys = resetRealtimePerfFlags();
    setStreamingScheduleTier(readStreamingScheduleTier());
    setPerformanceFlagsResetMessage(
      removedKeys.length > 0
        ? t("settings.performanceFlagsResetDone", { count: removedKeys.length })
        : t("settings.performanceFlagsResetAlreadyDefault"),
    );
  };

  const handleStreamingScheduleTierChange = (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const nextTier = event.target.value as RenderScheduleTier;
    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, nextTier);
    setStreamingScheduleTier(nextTier);
  };

  return (
    <section className="settings-section">
      {title ? <div className="settings-section-title">{title}</div> : null}
      {description ? (
        <div className="settings-section-subtitle">{description}</div>
      ) : null}
      {/* 内置精选 Skills：原独立侧栏入口已合并到其他设置 */}
      <CuratedSection
        appSettings={appSettings}
        onUpdateAppSettings={onUpdateAppSettings}
      />
      <Separator className="my-4" />
      <HistoryCompletionSettings />
      <Separator className="my-4" />
      <div className="settings-subsection-title">
        {t("settings.sharedProjectionTestTitle")}
      </div>
      <div className="settings-subsection-subtitle">
        {t("settings.sharedProjectionTestDescription")}
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">
            {t("settings.sharedProjectionTestToggleTitle")}
          </div>
          <div className="settings-toggle-subtitle">
            {t("settings.sharedProjectionTestToggleDescription")}
          </div>
          <div className="settings-help">
            {t("settings.sharedProjectionTestToggleDetail")}
          </div>
        </div>
        <Switch
          aria-label={t("settings.sharedProjectionTestToggleTitle")}
          checked={sharedProjectionTestEnabled}
          onCheckedChange={handleSharedProjectionTestToggle}
        />
      </div>
      <Separator className="my-4" />
      <div className="settings-subsection-title">
        {t("settings.performanceDiagnosticsTitle")}
      </div>
      <div className="settings-subsection-subtitle">
        {t("settings.performanceDiagnosticsDescription")}
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">
            {t("settings.streamingScheduleTierTitle")}
          </div>
          <div className="settings-toggle-subtitle">
            {t("settings.streamingScheduleTierDescription")}
          </div>
          <div className="settings-help">
            {t(`settings.streamingScheduleTierDetail.${streamingScheduleTier}`)}
          </div>
          <div className="settings-help">
            {t("settings.streamingScheduleTierRestartHint")}
          </div>
        </div>
        <select
          aria-label={t("settings.streamingScheduleTierTitle")}
          className="settings-select"
          value={streamingScheduleTier}
          onChange={handleStreamingScheduleTierChange}
        >
          {RENDER_SCHEDULE_TIER_VALUES.map((tier) => (
            <option key={tier} value={tier}>
              {t(`settings.streamingScheduleTier.${tier}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">
            {t("settings.performanceFlagsResetTitle")}
          </div>
          <div className="settings-toggle-subtitle">
            {t("settings.performanceFlagsResetDescription")}
          </div>
          {performanceFlagsResetMessage ? (
            <div className="settings-help">{performanceFlagsResetMessage}</div>
          ) : null}
        </div>
        <Button type="button" variant="outline" onClick={handleResetPerformanceFlags}>
          {t("settings.performanceFlagsResetButton")}
        </Button>
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">
            {t("settings.reactScanTitle")}
          </div>
          <div className="settings-toggle-subtitle">
            {t("settings.reactScanDescription")}
          </div>
          <div className="settings-help">{t("settings.reactScanDetail")}</div>
        </div>
        <Switch
          aria-label={t("settings.reactScanTitle")}
          checked={reactScanEnabled}
          onCheckedChange={handleReactScanToggle}
        />
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">
            {t("settings.perfDiagnosticsCaptureTitle")}
          </div>
          <div className="settings-toggle-subtitle">
            {t("settings.perfDiagnosticsCaptureDescription")}
          </div>
          <div className="settings-help">
            {t("settings.perfDiagnosticsCaptureDetail")}
          </div>
        </div>
        <Switch
          aria-label={t("settings.perfDiagnosticsCaptureTitle")}
          checked={perfDiagnosticsEnabled}
          onCheckedChange={handlePerfDiagnosticsToggle}
        />
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">
            {t("settings.perfCopyReportTitle")}
          </div>
          <div className="settings-toggle-subtitle">
            {t("settings.perfCopyReportDescription")}
          </div>
          {copyReportMessage ? (
            <div className="settings-help">{copyReportMessage}</div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleCopyPerfReport()}
        >
          {t("settings.perfCopyReportButton")}
        </Button>
      </div>
      <PerfJankLivePanel />
      <Separator className="my-4" />
      <CostBudgetSettingsSection />
      <Separator className="my-4" />
      <SessionRadarHistoryManagementSection
        entries={sessionRadarRecentCompletedSessions}
        onDeleteEntries={onDeleteSessionRadarHistory}
      />
      <Separator className="my-4" />
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">
            {t("settings.startupGateOverlayTestTitle")}
          </div>
          <div className="settings-toggle-subtitle">
            {t("settings.startupGateOverlayTestDescription")}
          </div>
          <div className="settings-help">
            {t("settings.startupGateOverlayTestDetail")}
          </div>
        </div>
        <Switch
          aria-label={t("settings.startupGateOverlayTestTitle")}
          checked={startupGateOverlayTestEnabled}
          onCheckedChange={handleStartupGateOverlayTestToggle}
        />
      </div>
    </section>
  );
}
