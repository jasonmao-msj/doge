import canonicalDogeIcon from "../../../../src-tauri/icons/app-icon-source.png";
import { setDockIcon } from "../../../services/tauri/settings";

/** Dock / app logo preference id. `default` is the shipping product icon. */
export type DockIconId =
  | "default"
  | "multi-orbit-hub"
  | "open-star-ring"
  | "gravitational-core"
  | "dual-orbit-handoff"
  | "layered-control-plane"
  | "four-port-router"
  | "adaptive-routing-fabric"
  | "triadic-router";

export const DEFAULT_DOCK_ICON_ID: DockIconId = "default";

export function sanitizeDockIconId(_value: unknown): DockIconId {
  // Historical values remain valid input data, but they no longer select a
  // visual identity. doge always resolves to its canonical app icon.
  return DEFAULT_DOCK_ICON_ID;
}

/** Resolve the canonical doge logo for Dock, About, lock screen, etc. */
export function resolveDockIconSrc(_iconId: unknown): string {
  return canonicalDogeIcon;
}

/** PNG signature: \x89PNG\r\n\x1a\n */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function assertPngBytes(bytes: Uint8Array, context: string): void {
  if (bytes.byteLength < PNG_MAGIC.length) {
    throw new Error(`${context}: dock icon payload too short`);
  }
  for (let i = 0; i < PNG_MAGIC.length; i += 1) {
    if (bytes[i] !== PNG_MAGIC[i]) {
      throw new Error(`${context}: dock icon payload is not a PNG`);
    }
  }
}

async function loadPngBytes(src: string): Promise<Uint8Array> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`failed to load dock icon asset: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  assertPngBytes(bytes, src);
  return bytes;
}

/**
 * Serializes icon refreshes so an older in-flight apply cannot overwrite a
 * newer refresh requested after another window opens.
 */
let dockIconApplyGeneration = 0;

/**
 * Apply the canonical doge app icon across platforms.
 *
 * Always loads the canonical PNG so the bundle, Dock, taskbar and window icons
 * stay consistent. Backend maps:
 * - macOS → NSApplication Dock icon (+ window chrome best-effort)
 * - Windows/Linux → window icons for every open window (taskbar / window chrome)
 *
 * Prefer re-calling this when secondary windows open so late-created surfaces
 * pick up the canonical icon (Win/Linux have no process-wide app icon API).
 */
export async function applyDockIconPreference(_iconId: unknown): Promise<void> {
  const generation = ++dockIconApplyGeneration;
  const src = resolveDockIconSrc(DEFAULT_DOCK_ICON_ID);
  const pngBytes = await loadPngBytes(src);
  if (generation !== dockIconApplyGeneration) {
    return;
  }
  await setDockIcon({ iconId: DEFAULT_DOCK_ICON_ID, pngBytes });
}

/**
 * Re-apply the canonical icon to all currently open windows.
 * The legacy function name remains stable for existing callers.
 * Call after creating secondary surfaces (About, detached explorer) on Win/Linux.
 */
export async function reapplyLastDockIconPreference(): Promise<void> {
  await applyDockIconPreference(DEFAULT_DOCK_ICON_ID);
}
