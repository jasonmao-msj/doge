// 性能诊断运行时开关的单一来源(localStorage `doge.perf.diagnostics`)。
//
// 独立、无其它依赖,供 perfDiagnosticsController(启停采集)与 perfBaseline web-vitals
// (MON-5 运行时放开)共用,避免两者互相 import 形成循环依赖。

const PERF_DIAGNOSTICS_FLAG_KEY = "doge.perf.diagnostics";

function canUseLocalStorage(): boolean {
  try {
    return (
      typeof globalThis !== "undefined" &&
      typeof globalThis.localStorage !== "undefined"
    );
  } catch {
    return false;
  }
}

/** 用户是否已打开性能诊断采集(持久化在 localStorage)。 */
export function isPerfDiagnosticsFlagEnabled(): boolean {
  if (!canUseLocalStorage()) {
    return false;
  }
  try {
    return globalThis.localStorage.getItem(PERF_DIAGNOSTICS_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistPerfDiagnosticsFlag(enabled: boolean): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    if (enabled) {
      globalThis.localStorage.setItem(PERF_DIAGNOSTICS_FLAG_KEY, "1");
    } else {
      globalThis.localStorage.removeItem(PERF_DIAGNOSTICS_FLAG_KEY);
    }
  } catch {
    // localStorage 是尽力而为,忽略配额 / 权限失败。
  }
}
