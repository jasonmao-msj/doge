import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type Viewer from "viewerjs";
import { isThemeMutationAttribute } from "../../theme/utils/themeAppearance";
import { loadMermaidFullscreenStyles } from "../../../styles/featureStyleLoaders";
import {
  destroyActiveViewer,
  getActiveViewer,
  setActiveViewer,
} from "./activeViewer";
import { preloadViewerjs } from "./preloadViewerjs";
import { svgToDataUrl } from "./svgToDataUrl";

type MermaidFullscreenViewerProps = {
  open: boolean;
  svg: string;
  onClose: () => void;
};

const PANEL_LOCK_SELECTOR = ".panel-lock-overlay";

/**
 * Renders a single Mermaid-rendered SVG inside a viewerjs fullscreen
 * viewer. The viewer is mounted via `createPortal` to `document.body` so
 * it escapes any `overflow: hidden` ancestor that the Mermaid block
 * itself sits inside (chat bubbles, file preview scrollers, etc.).
 *
 * Lifecycle:
 * - `open` flips true → ensure styles are loaded, await the (cached)
 *   viewerjs import, build a base64 data URL, construct a `<img>` portal,
 *   and create a viewerjs instance on it.
 * - viewerjs `hidden` event (ESC / backdrop click) → `onClose()`.
 * - `open` flips false or component unmounts → `viewer.destroy()` and
 *   clear the module-level singleton.
 *
 * Cross-cutting concerns:
 * - StrictMode: `cancelled` flag prevents the first effect from leaking
 *   a viewer if the second effect runs before the first dynamic import
 *   resolves.
 * - Theme switching: a MutationObserver on `<html>` calls
 *   `viewer.update()` when `data-theme` changes so the toolbar / backdrop
 *   pick up the new color tokens.
 * - panel-lock: a MutationObserver on `document.body` closes the viewer
 *   the moment the lock overlay is inserted, so the viewer's own
 *   keyboard handlers do not interfere with the lock screen.
 */
export default function MermaidFullscreenViewer({
  open,
  svg,
  onClose,
}: MermaidFullscreenViewerProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const onCloseRef = useRef(onClose);
  const imageSourceCacheRef = useRef<{
    svg: string;
    dataUrl: string;
  } | null>(null);

  // Keep the latest callback accessible to viewerjs options without
  // re-creating the viewer every time the parent re-renders.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !svg) {
      return;
    }
    // Make sure styles are present before the first paint of the viewer
    // — viewerjs needs its CSS to lay out the toolbar/backdrop correctly.
    void loadMermaidFullscreenStyles();

    let cancelled = false;
    let viewer: Viewer | null = null;
    let themeObserver: MutationObserver | null = null;
    let lockObserver: MutationObserver | null = null;

    (async () => {
      const { default: ViewerCtor } = await preloadViewerjs();
      if (cancelled || !imgRef.current) {
        return;
      }
      const imageElement = imgRef.current;
      const cachedSource = imageSourceCacheRef.current;
      const dataUrl =
        cachedSource?.svg === svg
          ? cachedSource.dataUrl
          : svgToDataUrl(svg);
      if (cachedSource?.svg !== svg) {
        imageSourceCacheRef.current = { svg, dataUrl };
      }
      // normalization 是同步 DOM work，必须留在 open/svg effect，不能回到
      // conversation render hot path；ViewerCtor 读取 image 前先注入 source。
      imageElement.src = dataUrl;

      // Singleton guarantee: close any previous viewer first so two
      // surfaces (message bubble + file preview) cannot overlap.
      destroyActiveViewer();

      const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      viewer = new ViewerCtor(imageElement, {
        container: document.body,
        inline: false,
        navbar: false,
        title: false,
        transition: !reducedMotion,
        toolbar: {
          zoomIn: true,
          zoomOut: true,
          oneToOne: true,
          reset: true,
          rotateLeft: true,
          rotateRight: true,
          flipHorizontal: true,
          flipVertical: true,
          prev: false,
          next: false,
          play: false,
        },
        shown() {
          if (cancelled) return;
          setActiveViewer(viewer);
        },
        hidden() {
          if (cancelled) return;
          onCloseRef.current();
        },
      });
      if (cancelled) {
        try {
          viewer.destroy();
        } catch {
          /* ignore */
        }
        return;
      }

      // viewerjs modal mode does not auto-show: it only listens for
      // click on the bound element. We open the fullscreen viewer
      // programmatically from a button click, so we must call show()
      // ourselves, otherwise the backdrop/toolbar never appear.
      viewer.show();

      // Theme switching: viewerjs does not read CSS variables on its
      // own once the viewer is mounted, so nudge it to re-render.
      themeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (isThemeMutationAttribute(mutation.attributeName)) {
            try {
              viewer?.update();
            } catch {
              /* ignore — viewer may already be gone */
            }
            break;
          }
        }
      });
      themeObserver.observe(document.documentElement, { attributes: true });

      // panel-lock: any insertion of the lock overlay must close us.
      lockObserver = new MutationObserver(() => {
        if (document.querySelector(PANEL_LOCK_SELECTOR)) {
          try {
            viewer?.destroy();
          } catch {
            /* ignore */
          }
          onCloseRef.current();
        }
      });
      lockObserver.observe(document.body, { childList: true, subtree: true });
    })();

    return () => {
      cancelled = true;
      themeObserver?.disconnect();
      lockObserver?.disconnect();
      if (viewer) {
        try {
          viewer.destroy();
        } catch {
          /* ignore */
        }
      }
      if (getActiveViewer() === viewer) {
        setActiveViewer(null);
      }
    };
  }, [open, svg]);

  if (!open || !svg || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <img
      ref={imgRef}
      alt=""
      aria-hidden="true"
      data-testid="mermaid-fullscreen-img"
    />,
    document.body,
  );
}
