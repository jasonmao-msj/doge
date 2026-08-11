// 把已持久化的 renderer diagnostics 汇总成一段可粘贴的纯文本("卡顿现场")。
//
// 供设置页「复制卡顿现场」按钮一键复制 / 下载,让用户把性能现场直接发给维护者定位,
// 无需自己看懂 react-scan。只输出性能相关标签,不含任何 prompt / assistant / 文件内容。

import {
  exportRendererDiagnostics,
  type RendererDiagnosticEntry,
} from "../rendererDiagnostics";
import { getReactScanAttributionState } from "../reactScanController";
import { SUSPEND_GAP_MS, isLongTaskObservable } from "./frameDropMonitor";
import { DOGE_NAME } from "../../config/brand";

const REPORT_MAX_ENTRIES = 80;
const REPORT_LABELS = [
  "perf.frame-drop",
  "perf.suspend-gap",
  "perf.longtask",
  "perf.longtask/unsupported",
  "perf.longtask/install-failed",
  "perf.web-vital",
  "perf.messages.row-render-budget",
  "renderer/blank-screen-suspected",
];

function getAppVersion(): string {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  return env.VITE_APP_VERSION || env.PACKAGE_VERSION || "unknown";
}

function getPlatform(): string {
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  return (navigator.userAgent || "unknown").slice(0, 200);
}

function readNumber(
  payload: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatEntry(entry: RendererDiagnosticEntry): string {
  const time = new Date(entry.timestamp).toISOString();
  let payload = "{}";
  try {
    payload = JSON.stringify(entry.payload ?? {});
  } catch {
    payload = "{unserializable}";
  }
  return `${time} ${entry.label} ${payload}`;
}

export function buildDiagnosticsReportText(): string {
  const all = exportRendererDiagnostics();
  const relevant = all.filter((entry) => REPORT_LABELS.includes(entry.label));
  const recent = relevant.slice(-REPORT_MAX_ENTRIES);
  const allFrameDrops = relevant.filter(
    (entry) => entry.label === "perf.frame-drop",
  );
  // 旧版监视器会把挂起/睡眠恢复记成 frame-drop(deltaMs 可达几十分钟),统计口径按
  // SUSPEND_GAP_MS 剔除这类历史脏条目,避免 worstFrameMs 被污染成无意义的天文数字。
  const suspendResumeFrames = allFrameDrops.filter(
    (entry) => (readNumber(entry.payload, "deltaMs") ?? 0) >= SUSPEND_GAP_MS,
  );
  const frameDrops = allFrameDrops.filter(
    (entry) => (readNumber(entry.payload, "deltaMs") ?? 0) < SUSPEND_GAP_MS,
  );
  const worstFrameMs = frameDrops.reduce((max, entry) => {
    const delta = readNumber(entry.payload, "deltaMs") ?? 0;
    return delta > max ? delta : max;
  }, 0);
  const longTasks = relevant.filter((entry) => entry.label === "perf.longtask");

  const headerLines = [
    `=== ${DOGE_NAME} 性能诊断 / performance report ===`,
    `generatedAt: ${new Date().toISOString()}`,
    `appVersion: ${getAppVersion()}`,
    `platform: ${getPlatform()}`,
    `totalEntries: ${all.length} | relevant: ${relevant.length} | shown: ${recent.length}`,
    `frameDropCount: ${frameDrops.length} | worstFrameMs: ${Math.round(worstFrameMs)} | longTaskCount: ${longTasks.length}`,
  ];
  if (!isLongTaskObservable()) {
    headerLines.push(
      "longTaskSupport: unsupported — 本平台无 longtask API,longTaskCount 恒为 0,不代表没有长任务",
    );
  }
  const attributionState = getReactScanAttributionState();
  headerLines.push(
    attributionState === "on"
      ? "renderAttribution: on — topRenders 为掉帧前 600ms 内渲染最多的组件(react-scan overlay)"
      : attributionState === "paused"
        ? "renderAttribution: paused — react-scan 工具条处于暂停态,onRender 归因被闸门跳过,topRenders 恒空;重开设置里的 react-scan 开关恢复"
        : attributionState === "missing"
          ? "renderAttribution: flag-on 但 instrumentation 未就绪 — topRenders 为空不代表没有渲染发生"
          : "renderAttribution: off — topRenders 为空是预期;需要组件归因请在设置里开启 react-scan overlay 后复现",
  );
  if (suspendResumeFrames.length > 0) {
    headerLines.push(
      `suspendResumeFrames: ${suspendResumeFrames.length} (deltaMs ≥ ${SUSPEND_GAP_MS} 视为挂起/睡眠恢复,已从掉帧统计剔除)`,
    );
  }
  const header = [...headerLines, ""].join("\n");

  if (recent.length === 0) {
    return `${header}(no performance diagnostics recorded — 打开设置里的「性能诊断采集」并复现卡顿后再导出)\n`;
  }

  // Dedicated "all frame drops" section: the tail above is capped at
  // REPORT_MAX_ENTRIES and interleaves other labels. This dumps EVERY recorded
  // frame drop (real ones + suspend/resume) with its full payload — including
  // `topRenders` attribution — sorted worst-first so the heaviest stalls are at
  // the top. NOTE: the react-scan "Update DOM vs JS-Hooks" self-time split is
  // computed inside the react-scan toolbar and is not available to app code, so
  // it cannot be included here.
  const worstFirst = [...allFrameDrops].sort(
    (a, b) =>
      (readNumber(b.payload, "deltaMs") ?? 0) -
      (readNumber(a.payload, "deltaMs") ?? 0),
  );
  const allDropsSection = [
    "",
    `--- ALL FRAME DROPS (${worstFirst.length}, worst first) ---`,
    ...worstFirst.map(formatEntry),
  ].join("\n");

  return `${header}${recent.map(formatEntry).join("\n")}\n${allDropsSection}\n`;
}
