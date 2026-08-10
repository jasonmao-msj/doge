export type VendorModelManagerTarget = "claude" | "codex" | "gemini";

export interface VendorModelManagerRequest {
  target: VendorModelManagerTarget;
  addMode?: boolean;
  /** Preferred managed provider profile for add-form default binding. */
  preferredProviderProfileId?: string | null;
}

const REQUEST_STORAGE_KEY = "doge.vendor.model-manager-request";
export const VENDOR_MODEL_MANAGER_REQUEST_EVENT =
  "doge:vendor-model-manager-request";

export function requestVendorModelManager(
  request: VendorModelManagerRequest,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const preferred =
    typeof request.preferredProviderProfileId === "string"
      ? request.preferredProviderProfileId.trim()
      : "";

  const payload = {
    target:
      request.target === "codex"
        ? "codex"
        : request.target === "gemini"
          ? "gemini"
          : "claude",
    addMode: Boolean(request.addMode),
    preferredProviderProfileId: preferred.length > 0 ? preferred : null,
    timestamp: Date.now(),
  } satisfies VendorModelManagerRequest & { timestamp: number };

  try {
    window.sessionStorage.setItem(REQUEST_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage write errors
  }

  window.dispatchEvent(new CustomEvent(VENDOR_MODEL_MANAGER_REQUEST_EVENT));
}

export function consumeVendorModelManagerRequest():
  | VendorModelManagerRequest
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(REQUEST_STORAGE_KEY);
    window.sessionStorage.removeItem(REQUEST_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<VendorModelManagerRequest>;
    const target =
      parsed.target === "codex"
        ? "codex"
        : parsed.target === "gemini"
          ? "gemini"
          : "claude";
    const preferred =
      typeof parsed.preferredProviderProfileId === "string"
        ? parsed.preferredProviderProfileId.trim()
        : "";
    return {
      target,
      addMode: Boolean(parsed.addMode),
      preferredProviderProfileId: preferred.length > 0 ? preferred : null,
    };
  } catch {
    return null;
  }
}
