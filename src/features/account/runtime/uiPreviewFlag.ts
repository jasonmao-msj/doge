/**
 * Build-only Account UI preview.
 *
 * There is intentionally no localStorage override: a normal build can never
 * be switched from the Real Native Gateway to the Mock Gateway at runtime.
 */
export const ACCOUNT_UI_PREVIEW_V1_ENABLED =
  import.meta.env.VITE_DOGE_ACCOUNT_UI_PREVIEW_V1 === "1";

export function isAccountUiPreviewV1Enabled(): boolean {
  return ACCOUNT_UI_PREVIEW_V1_ENABLED;
}
