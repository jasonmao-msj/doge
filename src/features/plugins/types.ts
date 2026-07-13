export interface PluginSkillCapability {
  entry: string;
}

export interface PluginViewerCapability {
  filePattern: string;
  action: "html-preview";
  title?: string;
}

export interface PluginGlossaryCapability {
  entry: string;
}

export interface PluginCapabilities {
  skill?: PluginSkillCapability;
  viewer?: PluginViewerCapability;
  glossary?: PluginGlossaryCapability;
}

export interface PluginManifest {
  manifestVersion: number;
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  repository?: string;
  license?: string;
  keywords: string[];
  capabilities: PluginCapabilities;
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  installPath: string;
  skillLinked: boolean;
}

export interface OfficialPluginCatalogEntry {
  id: string;
  name: string;
  description: string;
  repository: string;
  author?: string;
  /** 调试期覆盖安装来源（本地目录等）；缺省时从 repository 安装 */
  installSource?: string;
}
