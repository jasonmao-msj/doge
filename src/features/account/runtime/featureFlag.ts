/**
 * Doge Account convenience boundary.
 *
 * This flag can remove every Account entry point without affecting Local Mode.
 * A build-time off is authoritative. Otherwise a local override may disable the
 * default-on internal build, but can never re-enable a disabled build.
 */

export const ACCOUNT_CONVENIENCE_V1_STORAGE_KEY = "doge.accountConvenienceV1";

function parseFlagV1(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function readLocalOverrideV1(): boolean | null {
  try {
    if (typeof window === "undefined") return null;
    return parseFlagV1(window.localStorage.getItem(ACCOUNT_CONVENIENCE_V1_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Default-on, emergency opt-out; never gates or changes Local Mode. */
export function isAccountConvenienceV1Enabled(): boolean {
  const buildFlag = parseFlagV1(import.meta.env.VITE_DOGE_ACCOUNT_CONVENIENCE_V1);
  if (buildFlag === false) return false;
  return readLocalOverrideV1() ?? true;
}
