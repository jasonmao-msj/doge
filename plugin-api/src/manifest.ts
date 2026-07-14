// 插件清单（plugin.json）契约 —— CC GUI 形态。
// 融合 Obsidian 的兼容协商（minAppVersion）与咱们的静态 skill 声明。

/** 静态 skill 声明：安装时软链进 ~/.claude/skills，给 Claude agent 当技能。不进 JS 运行时 API。 */
export interface PluginSkillDeclaration {
  /** 相对插件根的技能入口目录/文件（禁 `..` 与绝对路径）。 */
  entry: string;
}

export interface PluginManifest {
  /** manifest 结构版本，当前为 1；为未来格式演进预留。 */
  manifestVersion?: number;
  /**
   * 插件唯一 ID。**发布后视为稳定 API，永不可变。**
   * 约定：小写字母 / 数字 / 连字符，不以连字符首尾。
   */
  id: string;
  /** 展示名。 */
  name: string;
  /** 语义化版本（x.y.z）。 */
  version: string;
  /** 运行本插件所需的最低 CC GUI 版本；宿主据此做兼容协商。 */
  minAppVersion: string;
  /** 一句话描述。 */
  description: string;
  /** JS 入口文件（相对插件根），默认 `main.js`；纯 skill 型插件可省略。 */
  main?: string;
  author?: string;
  authorUrl?: string;
  /** 源码仓库地址。 */
  repository?: string;
  license?: string;
  keywords?: string[];
  /** 静态 skill 能力声明（走软链，不需要 JS 运行时参与）。 */
  skill?: PluginSkillDeclaration;
  /** 运行时由宿主注入：插件安装目录路径。开发者只读。 */
  readonly dir?: string;
}
