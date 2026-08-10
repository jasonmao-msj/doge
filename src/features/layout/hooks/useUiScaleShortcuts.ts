import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings } from "../../../types";
import { applyUiScaleToDocument } from "../../../utils/applyUiScale";
import {
  confirmUiScaleHealthy,
  markUiScalePending,
  shouldForceUiScaleIdentity,
} from "../../../utils/uiScaleStartupGuard";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import { pushGlobalRuntimeNotice } from "../../../services/globalRuntimeNotices";
import {
  formatShortcutForPlatform,
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
} from "../../../utils/shortcuts";
import { clampUiScale, UI_SCALE_STEP } from "../../../utils/uiScale";
import {
  getStartupTraceSnapshot,
  subscribeStartupTrace,
} from "../../startup-orchestration/utils/startupTrace";
import {
  getStartupForceEnteredAtMs,
  isStartupForceEntered,
  subscribeStartupForceEnter,
} from "../../startup-orchestration/utils/startupForceEnter";

/**
 * Hard ceiling: apply stored uiScale even if startup-gate-ready never fires
 * (home-only shell / no workspace list).
 * Field: ANY uiScale ≠ 1 (0.8 / 0.9 / 1.1 / 1.2 / …) + early click during
 * full-catalog freezes on macOS and Windows — not a single-preset bug.
 */
export const UI_SCALE_COLD_START_MAX_DELAY_MS = 12_000;

/**
 * After force-enter, wait this long before applying ≠1 so the click window
 * is not stacked with CSS zoom + residual IPC.
 */
export const UI_SCALE_AFTER_FORCE_ENTER_DELAY_MS = 2_000;

/** @internal test-only: exercise production cold-start defer path under vitest. */
let forceColdStartDeferForTests = false;

/** @internal */
export function setUiScaleColdStartDeferForTests(enabled: boolean): void {
  forceColdStartDeferForTests = enabled;
}

type UseUiScaleShortcutsOptions = {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
};

type UseUiScaleShortcutsResult = {
  uiScale: number;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  queueSaveSettings: (next: AppSettings) => Promise<AppSettings>;
  increaseUiScale: () => void;
  decreaseUiScale: () => void;
  resetUiScale: () => void;
};

export function useUiScaleShortcuts({
  settings,
  setSettings,
  saveSettings,
}: UseUiScaleShortcutsOptions): UseUiScaleShortcutsResult {
  const { t } = useTranslation();
  const uiScale = clampUiScale(settings.uiScale);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    // CSS `zoom` carries uiScale; native WebView zoom is never touched.
    // setZoom (including identity writes during cold start) and transform+fill
    // freezes are documented in the historical Windows startup-hang analysis.
    //
    // Cold-start deferral: ANY uiScale ≠ 1 (0.8 / 0.9 / 1.1 / 1.2 / …) + early
    // clicks during list hydrate freezes WebView2 / WKWebView. Stay at identity
    // until cold-start is late-ready, then apply the stored scale.
    //
    // Startup guard: previous unhealthy ≠1 session → force 1 this session only
    // (never rewrite settings).
    let effectiveScale = uiScale;
    let forcedIdentity = false;
    if (uiScale !== 1 && shouldForceUiScaleIdentity()) {
      effectiveScale = 1;
      forcedIdentity = true;
    }
    let cancelled = false;
    const apply = (scale: number) => {
      if (cancelled) {
        return;
      }
      void applyUiScaleToDocument(scale).catch((error) => {
        appendRendererDiagnostic("ui-scale/css-apply-failed", {
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          scale,
        });
      });
    };

    // Phase 1: always identity first.
    //
    // On cold start every CSS property in ZOOM_FILL_PROPS is already empty and
    // --ui-scale defaults to 1 in :root, so apply(1) is a true no-op that does
    // not dirty the Blink layout tree.  The conditional clearing inside
    // applyUiScale (clearResidualScaleStyles / hasResidualScaleStyle) guarantees
    // we only write when there is a leftover value to remove.
    apply(1);
    confirmUiScaleHealthy();

    if (forcedIdentity) {
      appendRendererDiagnostic("ui-scale/startup-guard-forced-identity", {
        storedScale: uiScale,
      });
      pushGlobalRuntimeNotice({
        severity: "warning",
        category: "diagnostic",
        messageKey: "runtimeNotice.uiScale.startupGuardReset",
        messageParams: { scale: Math.round(uiScale * 100) },
        dedupeKey: "ui-scale:startup-guard-forced-identity",
      });
      return () => {
        cancelled = true;
      };
    }

    if (effectiveScale === 1) {
      return () => {
        cancelled = true;
      };
    }

    // Phase 2: apply ANY user scale ≠ 1 only after cold-start is late-ready,
    // or after a hard ceiling. Earlier (0.8–3s idle) still overlapped
    // full-catalog + pointer on macOS / WebView2 for every non-identity scale.
    const isVitest =
      typeof import.meta !== "undefined" &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (import.meta as any).env?.MODE === "test";
    // Default tests apply immediately; opt into real defer via test helper.
    const useImmediateApply = isVitest && !forceColdStartDeferForTests;

    let appliedUserScale = false;
    const applyUserScaleOnce = () => {
      if (cancelled || appliedUserScale) {
        return;
      }
      appliedUserScale = true;
      apply(effectiveScale);
      markUiScalePending(effectiveScale);
    };

    if (useImmediateApply) {
      const t = window.setTimeout(() => {
        applyUserScaleOnce();
      }, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }

    let forceEnterTimer: number | null = null;

    const tryApplyUserScale = () => {
      if (cancelled || appliedUserScale) {
        return;
      }
      const milestones = getStartupTraceSnapshot().milestones;
      // force-enter also stamps startup-gate-ready. Honor its quiet window
      // before the generic milestone branch so the click cannot immediately
      // collide with a CSS relayout.
      if (isStartupForceEntered()) {
        const enteredAt = getStartupForceEnteredAtMs();
        const elapsed =
          (typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now()) - enteredAt;
        if (elapsed >= UI_SCALE_AFTER_FORCE_ENTER_DELAY_MS) {
          applyUserScaleOnce();
          return;
        }
        if (forceEnterTimer == null) {
          forceEnterTimer = window.setTimeout(() => {
            forceEnterTimer = null;
            tryApplyUserScale();
          }, Math.max(0, UI_SCALE_AFTER_FORCE_ENTER_DELAY_MS - elapsed));
        }
        return;
      }
      // Prefer full-catalog done. Home-only: input-ready without ever starting list.
      if (
        milestones["startup-gate-ready"] ||
        (milestones["input-ready"] && !milestones["active-workspace-ready"])
      ) {
        applyUserScaleOnce();
        return;
      }
    };

    tryApplyUserScale();
    const unsubTrace = subscribeStartupTrace(tryApplyUserScale);
    const unsubForce = subscribeStartupForceEnter(tryApplyUserScale);
    const ceilingTimer = window.setTimeout(() => {
      applyUserScaleOnce();
    }, UI_SCALE_COLD_START_MAX_DELAY_MS);

    return () => {
      cancelled = true;
      unsubTrace();
      unsubForce();
      window.clearTimeout(ceilingTimer);
      if (forceEnterTimer != null) {
        window.clearTimeout(forceEnterTimer);
      }
    };
  }, [uiScale]);

  const scaleShortcutTitle = useMemo(() => {
    const increase = formatShortcutForPlatform(settings.increaseUiScaleShortcut);
    const decrease = formatShortcutForPlatform(settings.decreaseUiScaleShortcut);
    const reset = formatShortcutForPlatform(settings.resetUiScaleShortcut);
    return t("settings.uiScaleShortcutTitle", {
      increase,
      decrease,
      reset,
    });
  }, [
    settings.decreaseUiScaleShortcut,
    settings.increaseUiScaleShortcut,
    settings.resetUiScaleShortcut,
    t,
  ]);
  const scaleShortcutText = t("settings.uiScaleShortcutText", {
    shortcuts: scaleShortcutTitle,
  });

  const saveQueueRef = useRef(Promise.resolve());
  const queueSaveSettings = useCallback(
    (next: AppSettings) => {
      const task = () => saveSettings(next);
      const queued = saveQueueRef.current.then(task, task);
      saveQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [saveSettings],
  );

  const handleScaleDelta = useCallback(
    (delta: number) => {
      setSettings((current) => {
        const nextScale = clampUiScale(current.uiScale + delta);
        if (nextScale === current.uiScale) {
          return current;
        }
        const nextSettings = {
          ...current,
          uiScale: nextScale,
        };
        void queueSaveSettings(nextSettings);
        return nextSettings;
      });
    },
    [queueSaveSettings, setSettings],
  );

  const handleScaleReset = useCallback(() => {
    setSettings((current) => {
      if (current.uiScale === 1) {
        return current;
      }
      const nextSettings = {
        ...current,
        uiScale: 1,
      };
      void queueSaveSettings(nextSettings);
      return nextSettings;
    });
  }, [queueSaveSettings, setSettings]);

  const increaseUiScale = useCallback(
    () => handleScaleDelta(UI_SCALE_STEP),
    [handleScaleDelta],
  );
  const decreaseUiScale = useCallback(
    () => handleScaleDelta(-UI_SCALE_STEP),
    [handleScaleDelta],
  );

  useEffect(() => {
    const handleScaleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (
        isEditableShortcutTarget(event.target) ||
        isEditableShortcutTarget(document.activeElement)
      ) {
        return;
      }
      const isIncrease = matchesShortcutForPlatform(
        event,
        settings.increaseUiScaleShortcut,
      );
      const isDecrease = matchesShortcutForPlatform(
        event,
        settings.decreaseUiScaleShortcut,
      );
      const isReset = matchesShortcutForPlatform(
        event,
        settings.resetUiScaleShortcut,
      );
      if (!isIncrease && !isDecrease && !isReset) {
        return;
      }
      event.preventDefault();
      if (isReset) {
        handleScaleReset();
        return;
      }
      if (isDecrease) {
        decreaseUiScale();
      } else {
        increaseUiScale();
      }
    };
    window.addEventListener("keydown", handleScaleShortcut);
    return () => {
      window.removeEventListener("keydown", handleScaleShortcut);
    };
  }, [
    decreaseUiScale,
    handleScaleReset,
    increaseUiScale,
    settings.decreaseUiScaleShortcut,
    settings.increaseUiScaleShortcut,
    settings.resetUiScaleShortcut,
  ]);

  return {
    uiScale,
    scaleShortcutTitle,
    scaleShortcutText,
    queueSaveSettings,
    increaseUiScale,
    decreaseUiScale,
    resetUiScale: handleScaleReset,
  };
}
