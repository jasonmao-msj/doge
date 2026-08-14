import multiOrbitHubIcon from "../../../assets/dock-icons/orbit-routing/multi-orbit-hub.png";
import openStarRingIcon from "../../../assets/dock-icons/orbit-routing/open-star-ring.png";
import gravitationalCoreIcon from "../../../assets/dock-icons/orbit-routing/gravitational-core.png";
import dualOrbitHandoffIcon from "../../../assets/dock-icons/orbit-routing/dual-orbit-handoff.png";
import layeredControlPlaneIcon from "../../../assets/dock-icons/orbit-routing/layered-control-plane.png";
import fourPortRouterIcon from "../../../assets/dock-icons/orbit-routing/four-port-router.png";
import adaptiveRoutingFabricIcon from "../../../assets/dock-icons/orbit-routing/adaptive-routing-fabric.png";
import triadicRouterIcon from "../../../assets/dock-icons/orbit-routing/triadic-router.png";
import { setDockIcon } from "../../../services/tauri/settings";
import { DOGE_PRODUCT_ICON_SRC } from "../../brand/runtime/productIcon";

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

export type DockIconOption = {
  id: DockIconId;
  /** Vite-resolved asset URL used for UI + native Dock apply. */
  src: string;
  labelKey: string;
};

export const DEFAULT_DOCK_ICON_ID: DockIconId = "default";

export const DOCK_ICON_OPTIONS: readonly DockIconOption[] = [
  {
    id: "default",
    src: DOGE_PRODUCT_ICON_SRC,
    labelKey: "settings.dockIconDefault",
  },
  {
    id: "multi-orbit-hub",
    src: multiOrbitHubIcon,
    labelKey: "settings.dockIconMultiOrbitHub",
  },
  {
    id: "open-star-ring",
    src: openStarRingIcon,
    labelKey: "settings.dockIconOpenStarRing",
  },
  {
    id: "gravitational-core",
    src: gravitationalCoreIcon,
    labelKey: "settings.dockIconGravitationalCore",
  },
  {
    id: "dual-orbit-handoff",
    src: dualOrbitHandoffIcon,
    labelKey: "settings.dockIconDualOrbitHandoff",
  },
  {
    id: "layered-control-plane",
    src: layeredControlPlaneIcon,
    labelKey: "settings.dockIconLayeredControlPlane",
  },
  {
    id: "four-port-router",
    src: fourPortRouterIcon,
    labelKey: "settings.dockIconFourPortRouter",
  },
  {
    id: "adaptive-routing-fabric",
    src: adaptiveRoutingFabricIcon,
    labelKey: "settings.dockIconAdaptiveRoutingFabric",
  },
  {
    id: "triadic-router",
    src: triadicRouterIcon,
    labelKey: "settings.dockIconTriadicRouter",
  },
] as const;

const DOCK_ICON_ID_SET = new Set<string>(
  DOCK_ICON_OPTIONS.map((option) => option.id),
);

const DOCK_ICON_SRC_BY_ID: Record<DockIconId, string> = DOCK_ICON_OPTIONS.reduce(
  (acc, option) => {
    acc[option.id] = option.src;
    return acc;
  },
  {} as Record<DockIconId, string>,
);

export function isDockIconId(value: unknown): value is DockIconId {
  return typeof value === "string" && DOCK_ICON_ID_SET.has(value);
}

export function sanitizeDockIconId(value: unknown): DockIconId {
  return isDockIconId(value) ? value : DEFAULT_DOCK_ICON_ID;
}

/** Resolve logo URL for Dock settings, About, lock screen, etc. */
export function resolveDockIconSrc(iconId: unknown): string {
  const safeId = sanitizeDockIconId(iconId);
  return DOCK_ICON_SRC_BY_ID[safeId] ?? DOCK_ICON_SRC_BY_ID[DEFAULT_DOCK_ICON_ID];
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
 * Serializes rapid preference changes so an older in-flight apply cannot
 * overwrite a newer selection (common when users click through the rail quickly).
 */
let dockIconApplyGeneration = 0;

/** Last successfully requested id (used to re-stamp secondary windows on Win/Linux). */
let lastRequestedDockIconId: DockIconId = DEFAULT_DOCK_ICON_ID;

/**
 * Apply app icon preference across platforms.
 *
 * Always loads PNG bytes (including `default`) so picker / Dock / taskbar / window
 * icons stay consistent. Backend maps:
 * - macOS → NSApplication Dock icon (+ window chrome best-effort)
 * - Windows/Linux → window icons for every open window (taskbar / window chrome)
 *
 * Prefer re-calling this when secondary windows open so late-created surfaces
 * pick up the current preference (Win/Linux have no process-wide app icon API).
 */
export async function applyDockIconPreference(iconId: unknown): Promise<void> {
  const generation = ++dockIconApplyGeneration;
  const safeId = sanitizeDockIconId(iconId);
  lastRequestedDockIconId = safeId;
  const src = resolveDockIconSrc(safeId);
  const pngBytes = await loadPngBytes(src);
  if (generation !== dockIconApplyGeneration) {
    return;
  }
  await setDockIcon({ iconId: safeId, pngBytes });
}

/**
 * Re-apply the last selected icon to all currently open windows.
 * Call after creating secondary surfaces (About, detached explorer) on Win/Linux.
 */
export async function reapplyLastDockIconPreference(): Promise<void> {
  await applyDockIconPreference(lastRequestedDockIconId);
}
