import { openUrl } from "@tauri-apps/plugin-opener";

export async function openAccountExternalUrl(url: string): Promise<void> {
  await openUrl(url);
}
