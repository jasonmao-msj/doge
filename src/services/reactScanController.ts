// Runtime controller for the react-scan render-profiling overlay.
//
// react-scan ships inside production bundles on purpose so it can be toggled from
// the in-app settings page (Other -> Performance diagnostics). The module itself is
// loaded lazily via dynamic import, so it stays in a separate chunk that is only
// fetched when the overlay is actually turned on.

import { recordReactScanRender } from "./perfBaseline/reactScanRenderLog";

type ReactScanModule = typeof import("react-scan");

const REACT_SCAN_FLAG_KEY = "ccgui.perf.reactScan";
// react-scan 自己的 options 持久化键。它会把 enabled 落盘并在每次 start() 时 restore,
// 覆盖 scan({enabled:true}) 传入的值;一旦盘上残留 enabled:false(点过工具条暂停键),
// instrumentation.isPaused 恒为 true,options.onRender 被 shouldFullyAbort 闸门跳过,
// 掉帧归因(topRenders)就会恒空——而面板自己的计时不受该闸门影响,故极难察觉。
const REACT_SCAN_MODULE_OPTIONS_KEY = "react-scan-options";

let cachedModule: ReactScanModule | null = null;
let loadPromise: Promise<ReactScanModule> | null = null;

function canUseLocalStorage(): boolean {
  try {
    return typeof globalThis !== "undefined" && typeof globalThis.localStorage !== "undefined";
  } catch {
    return false;
  }
}

/** Whether the user toggled the overlay on (persisted in localStorage). */
export function isReactScanFlagEnabled(): boolean {
  if (!canUseLocalStorage()) {
    return false;
  }
  try {
    return globalThis.localStorage.getItem(REACT_SCAN_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/** Sync check used at boot to decide whether to start the overlay before first render. */
export function isReactScanStartupEnabled(): boolean {
  const env = import.meta.env as { DEV?: boolean; VITE_ENABLE_REACT_SCAN?: string };
  const envEnabled = env.DEV === true && env.VITE_ENABLE_REACT_SCAN === "1";
  return envEnabled || isReactScanFlagEnabled();
}

export type ReactScanAttributionState = "on" | "paused" | "missing" | "off";

/**
 * 归因管线的实时状态。诊断报告曾只看启动 flag 就打印 "renderAttribution: on",
 * 而 react-scan 工具条暂停态(持久化 enabled:false)会让 onRender 被 shouldFullyAbort
 * 闸门跳过,topRenders 恒空——flag 与真实数据流必须分开汇报。
 */
export function getReactScanAttributionState(): ReactScanAttributionState {
  if (!isReactScanStartupEnabled()) {
    return "off";
  }
  const instrumentation = cachedModule?.ReactScanInternals?.instrumentation;
  if (!instrumentation) {
    return "missing";
  }
  return instrumentation.isPaused?.value === true ? "paused" : "on";
}

function persistFlag(enabled: boolean): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    if (enabled) {
      globalThis.localStorage.setItem(REACT_SCAN_FLAG_KEY, "1");
    } else {
      globalThis.localStorage.removeItem(REACT_SCAN_FLAG_KEY);
    }
  } catch {
    // localStorage is best effort; ignore quota/permission failures.
  }
}

function loadReactScan(): Promise<ReactScanModule> {
  if (!loadPromise) {
    loadPromise = import("react-scan").then((mod) => {
      cachedModule = mod;
      return mod;
    });
  }
  return loadPromise;
}

function sanitizePersistedReactScanOptions(): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    const raw = globalThis.localStorage.getItem(REACT_SCAN_MODULE_OPTIONS_KEY);
    if (!raw) {
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && (parsed as { enabled?: unknown }).enabled === false) {
      globalThis.localStorage.setItem(
        REACT_SCAN_MODULE_OPTIONS_KEY,
        JSON.stringify({ ...(parsed as Record<string, unknown>), enabled: true }),
      );
    }
  } catch {
    // best effort; a broken persisted blob just means react-scan falls back to defaults.
  }
}

async function applyReactScan(enabled: boolean): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  // Nothing to tear down if react-scan was never loaded.
  if (!enabled && cachedModule === null && loadPromise === null) {
    return;
  }
  try {
    if (enabled) {
      // 必须在 scan() 之前清理:scan() 内部的 setOptions/start 会读盘 restore enabled。
      sanitizePersistedReactScanOptions();
    }
    const mod = await loadReactScan();
    // dangerouslyForceRunInProduction is required: this app bundles react-scan into
    // production builds intentionally, and without this flag react-scan refuses to run
    // outside development. In production builds only re-render highlights and counts are
    // available (React strips per-render timings from production builds).
    mod.scan({
      enabled,
      showToolbar: enabled,
      // 在工具条直接显示 FPS,便于第一眼看到掉帧(生产版只有 FPS/计数,无 per-render 计时)。
      showFPS: true,
      dangerouslyForceRunInProduction: true,
      // MON-3:把每次 commit 的组件渲染记入日志,供掉帧现场回答"谁在重渲染"。
      onRender: (fiber, renders) => {
        recordReactScanRender(fiber, renders);
      },
    });
  } catch (error) {
    console.error("Failed to apply react-scan overlay:", error);
  }
}

/** Start the overlay at app boot when the persisted flag (or dev env var) is set. */
export async function startReactScanOverlay(): Promise<void> {
  await applyReactScan(true);
}

/** Toggle the overlay from settings: persist the choice and apply it live. */
export async function setReactScanEnabled(enabled: boolean): Promise<void> {
  persistFlag(enabled);
  await applyReactScan(enabled);
}
