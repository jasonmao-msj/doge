/**
 * Trigger a browser download of the given SVG string. We build a Blob with
 * an explicit `image/svg+xml` MIME and click a hidden anchor, then revoke
 * the object URL on the next tick. Filename defaults to `mermaid.svg`.
 *
 * We do not rely on `URL.createObjectURL` long-term retention because the
 * Tauri webview holds onto object URLs across navigation under some
 * versions, and a small file does not need the extra memory pressure.
 */
export function downloadSvg(svg: string, filename: string = "mermaid.svg"): void {
  if (!svg) {
    return;
  }
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Defer revoke so the download has a chance to commit; some browsers
  // (notably older WebKit) need the URL to be live when the click resolves.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
