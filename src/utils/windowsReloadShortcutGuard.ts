import { isWindowsPlatform } from "./platform";

export function isWindowsBrowserReloadKey(
  event: Pick<KeyboardEvent, "key" | "code">,
): boolean {
  return event.key === "F5" || event.code === "F5";
}

/** Renderer fallback for the native WebView2 accelerator guard. */
export function installWindowsReloadShortcutGuard(
  target: Pick<Window, "addEventListener" | "removeEventListener"> | undefined =
    typeof window === "undefined" ? undefined : window,
  isWindows: boolean = isWindowsPlatform(),
): () => void {
  if (!target || !isWindows) {
    return () => {};
  }
  const handleKeyDown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (isWindowsBrowserReloadKey(keyboardEvent)) {
      keyboardEvent.preventDefault();
    }
  };
  target.addEventListener("keydown", handleKeyDown, true);
  return () => target.removeEventListener("keydown", handleKeyDown, true);
}
