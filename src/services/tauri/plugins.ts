import { invoke } from "@tauri-apps/api/core";
import type { InstalledPlugin } from "../../features/plugins/types";

export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  return invoke<InstalledPlugin[]>("plugin_list_installed");
}

export async function installPlugin(source: string): Promise<InstalledPlugin> {
  return invoke<InstalledPlugin>("plugin_install", { source });
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  return invoke("plugin_uninstall", { pluginId });
}

export async function readPluginGlossary(pluginId: string): Promise<string> {
  return invoke<string>("plugin_read_glossary", { pluginId });
}
