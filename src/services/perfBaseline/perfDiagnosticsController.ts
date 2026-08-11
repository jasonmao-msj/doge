// 运行时性能诊断开关(与 react-scan overlay 开关平级)。
//
// 背景:web-vitals 等基线诊断被 build-time PROD 门禁关死,而用户卡顿的正是打包版。
// 本控制器提供一个持久化的运行时开关(localStorage `doge.perf.diagnostics`),启停
// rAF 掉帧监视器、longtask 观测与最近交互跟踪。这些采集器底层用 appendRendererDiagnostic
// (无 build-time 门控),所以打包版同样可用。默认关闭,避免常态开销;用户在设置页打开
// 后即时生效。

import {
  installPerfInteractionTracking,
  uninstallPerfInteractionTracking,
} from "./perfContextBridge";
import {
  startFrameDropMonitor,
  startLongTaskObserver,
  stopFrameDropMonitor,
  stopLongTaskObserver,
} from "./frameDropMonitor";
import {
  isPerfDiagnosticsFlagEnabled,
  persistPerfDiagnosticsFlag,
} from "./perfDiagnosticsFlag";

// 供设置页读取当前开关(单一来源在 perfDiagnosticsFlag)。
export { isPerfDiagnosticsFlagEnabled };

let running = false;

function startMonitors(): void {
  if (running) {
    return;
  }
  running = true;
  installPerfInteractionTracking();
  startFrameDropMonitor();
  startLongTaskObserver();
  // MON-5:即便打包版关闭了 build-time perf baseline,也在运行时开关下采集 web-vitals(INP)。
  void import("./index")
    .then((module) => module.installPerfBaselineWebVitals(true))
    .catch(() => {
      // web-vitals 采集是尽力而为。
    });
}

function stopMonitors(): void {
  if (!running) {
    return;
  }
  running = false;
  stopFrameDropMonitor();
  stopLongTaskObserver();
  uninstallPerfInteractionTracking();
}

function isDevBuild(): boolean {
  const env = (import.meta.env ?? {}) as { DEV?: boolean; MODE?: string };
  return env.DEV === true && env.MODE !== "test";
}

/**
 * 应用启动时调用:持久化开关为开时启动采集。
 * dev 构建下无条件启动:掉帧监视器 + hotspot 归因是排查流式卡顿的第一手证据,
 * 其常态开销只有一个 rAF 循环(上报本身有 500ms 节流 + 单会话上限)。
 */
export function startPerfDiagnosticsIfEnabled(): void {
  if (isDevBuild() || isPerfDiagnosticsFlagEnabled()) {
    startMonitors();
  }
}

/** 从设置页切换:持久化选择并即时启停采集。 */
export function setPerfDiagnosticsEnabled(enabled: boolean): void {
  persistPerfDiagnosticsFlag(enabled);
  if (enabled) {
    startMonitors();
  } else {
    stopMonitors();
  }
}

export function __resetPerfDiagnosticsControllerForTests(): void {
  stopMonitors();
}
