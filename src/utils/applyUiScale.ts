import {
  detectRendererPlatform,
  type RendererPlatform,
} from "./rendererPlatform";
import { clampUiScale } from "./uiScale";

export type ApplyUiScaleTarget = {
  root: HTMLElement;
  platform: RendererPlatform;
};

/**
 * Apply uiScale without native WebView zoom ≠1.
 *
 * Field evidence (Windows WebView2, 2026-08):
 * 1. setZoom(uiScale≠1) freezes the renderer (multi-GB).
 * 2. body { transform:scale + width/height:100/scale% } also freezes when
 *    combined with cold-start list hydration + early pointer input.
 *
 * Current strategy: CSS `zoom` only (layout-participating, no expanded
 * pre-transform surface). Production never calls native WebView zoom.
 *
 * Shell: html/body/#root/.app use a % height chain (base.css), not 100vh.
 */
export function usesCssPageZoom(_platform: RendererPlatform): boolean {
  return true;
}

/**
 * Transform layout-fill path is retired (WebView2 memory bomb).
 * Always null so callers clear width/height.
 *
 * @internal exported for unit tests
 */
export function cssZoomLayoutFillSize(scale: number): string | null {
  void clampUiScale(scale);
  return null;
}

/**
 * Prefer <body> when root is <html>; keep detached test roots as-is.
 *
 * @internal exported for unit tests
 */
export function resolveCssZoomLayoutTarget(root: HTMLElement): HTMLElement {
  const doc = root.ownerDocument;
  if (doc?.documentElement === root && doc.body) {
    return doc.body;
  }
  return root;
}

/**
 * Platform-split CSS scale management.
 *
 * macOS WKWebView uses stale hit-test data.  When cold-start applyUiScale(1)
 * writes zero CSS properties the CSSOM tree is never materialised in WKWebView;
 * the first user click triggers hit-test → synchronous style recalc + layout
 * that deadlocks the main thread.  Unconditional inline writes during the
 * first effect force early CSSOM initialisation so hit-test data is fresh.
 *
 * Windows WebView2 (Chromium Blink) eagerly builds the CSSOM, so every inline
 * write invalidates the style tree and triggers a full style recalc + layout
 * that competes with the compositor for the first-paint hit-test.  Only touch
 * properties that carry a residual value (hot-reload, earlier non-identity
 * scale, or stale transform fill from an older build).
 */

/** CSSOM property names (kebab-case) for scale-related inline styles. */
const ZOOM_FILL_CSS_PROPS = [
  "zoom",
  "transform",
  "transform-origin",
  "width",
  "height",
  "position",
  "top",
  "left",
  "right",
  "bottom",
] as const;

// ── macOS: unconditional path (validated before e0ddd9e99) ──

/** Unconditionally clear all 10 scale-related inline properties. */
function clearScaleLayoutStyles(el: HTMLElement): void {
  el.style.zoom = "";
  el.style.transform = "";
  el.style.transformOrigin = "";
  el.style.width = "";
  el.style.height = "";
  el.style.position = "";
  el.style.top = "";
  el.style.left = "";
  el.style.right = "";
  el.style.bottom = "";
}

/**
 * macOS: unconditional fill clear + zoom write.
 * Always touches 10 properties so WKWebView materialises the CSSOM before the
 * first click arrives.
 */
function setScaleLayoutStyles_Mac(el: HTMLElement, scale: number): void {
  el.style.transform = "";
  el.style.transformOrigin = "";
  el.style.width = "";
  el.style.height = "";
  el.style.position = "";
  el.style.top = "";
  el.style.left = "";
  el.style.right = "";
  el.style.bottom = "";

  if (scale === 1) {
    el.style.zoom = "";
    return;
  }

  el.style.zoom = String(scale);
}

// ── Windows: residual-only path ──

/** Only clear properties that carry a non-empty inline value. */
function clearResidualScaleStyles(el: HTMLElement): void {
  for (const prop of ZOOM_FILL_CSS_PROPS) {
    // jsdom does not expose the non-standard `zoom` accessor through
    // getPropertyValue/removeProperty, so inspect and clear it directly.
    if (prop === "zoom") {
      if (el.style.zoom !== "") {
        el.style.zoom = "";
      }
      continue;
    }
    if (el.style.getPropertyValue(prop) !== "") {
      el.style.removeProperty(prop);
    }
  }
}

/**
 * Windows: zero writes at scale=1 on cold start.  Leaves already-clean
 * properties alone so first-paint does not invalidate the Blink layout tree.
 *
 * Uses `style.zoom =` (not setProperty) because jsdom does not map
 * setProperty("zoom", …) to the style.zoom getter.  In Chromium / WKWebView
 * both forms are equivalent — they trigger the same CSSOM mutation path.
 */
function setResidualScaleLayoutStyles(el: HTMLElement, scale: number): void {
  clearResidualScaleStyles(el);

  if (scale === 1) {
    return;
  }

  el.style.zoom = String(scale);
}

function applyCssPageScaleStyles(
  root: HTMLElement,
  scale: number,
  platform: RendererPlatform,
): void {
  const isMacOS = platform === "macos";

  // macOS always writes --ui-scale to force CSSOM init.
  // Windows only writes --ui-scale for non-identity scales (CSS :root already
  // declares --ui-scale: 1 in themes.dark.css, an inline write of the same
  // value shifts cascade origin and forces Chromium to re-resolve consumers).
  if (isMacOS) {
    root.style.setProperty("--ui-scale", String(scale));
  } else {
    if (scale !== 1) {
      root.style.setProperty("--ui-scale", String(scale));
    } else if (root.style.getPropertyValue("--ui-scale")) {
      root.style.removeProperty("--ui-scale");
    }
  }

  const layout = resolveCssZoomLayoutTarget(root);
  if (layout !== root) {
    if (isMacOS) {
      clearScaleLayoutStyles(root);
    } else {
      clearResidualScaleStyles(root);
    }
  }

  if (isMacOS) {
    setScaleLayoutStyles_Mac(layout, scale);
  } else {
    setResidualScaleLayoutStyles(layout, scale);
  }
}

/** @internal test helper */
export function resetApplyUiScaleQueueForTests(): void {
  applyQueue = Promise.resolve();
  applyGeneration = 0;
}

let applyQueue: Promise<void> = Promise.resolve();
let applyGeneration = 0;

/**
 * Serialise applies so rapid shortcut spam cannot reorder CSS writes.
 * Stale generations are skipped after they reach the head of the queue.
 */
export function enqueueApplyUiScale(
  scale: number,
  target: ApplyUiScaleTarget,
): Promise<void> {
  const generation = ++applyGeneration;
  const run = async () => {
    if (generation !== applyGeneration) {
      return;
    }
    await applyUiScale(scale, target);
  };
  applyQueue = applyQueue.then(run, run);
  return applyQueue;
}

export async function applyUiScale(
  scale: number,
  target: ApplyUiScaleTarget,
): Promise<void> {
  const next = clampUiScale(scale);

  applyCssPageScaleStyles(target.root, next, target.platform);
}

/** Convenience for production hook: detect platform and apply CSS-only zoom. */
export async function applyUiScaleToDocument(
  scale: number,
  options?: {
    root?: HTMLElement;
    platform?: RendererPlatform;
    /** default true — use serial queue */
    enqueue?: boolean;
  },
): Promise<void> {
  const root = options?.root ?? globalThis.document?.documentElement;
  if (!root) {
    return;
  }
  const target: ApplyUiScaleTarget = {
    root,
    platform: options?.platform ?? detectRendererPlatform(),
  };
  if (options?.enqueue === false) {
    await applyUiScale(scale, target);
    return;
  }
  await enqueueApplyUiScale(scale, target);
}
