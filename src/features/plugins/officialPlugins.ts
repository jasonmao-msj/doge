import type { OfficialPluginCatalogEntry } from "./types";

/**
 * v1 官方插件目录：仅承载展示元数据与仓库地址。
 * 能力事实源永远是插件仓库内的 plugin.json，本目录不得声明能力。
 */

// 调试期本地插件包目录：通过 .env.local 的 VITE_PLUGIN_DEMOS_DIR 注入（不入库），
// 未设置时官方插件回退到 repository 远程安装。绝不写死个人绝对路径。
const PLUGIN_DEMOS_DIR =
  import.meta.env.VITE_PLUGIN_DEMOS_DIR?.replace(/[/\\]+$/, "") ?? "";

function localInstallSource(dirName: string): string | undefined {
  return PLUGIN_DEMOS_DIR ? `${PLUGIN_DEMOS_DIR}/${dirName}` : undefined;
}

export const OFFICIAL_PLUGINS: OfficialPluginCatalogEntry[] = [
  {
    id: "gzh-design",
    name: "公众号排版",
    description:
      "把 Markdown 一键排成可直接粘贴进微信公众号编辑器的精致 HTML，内置 6 套主题与主题生成器。",
    repository: "https://github.com/isjiamu/gzh-design-skill",
    author: "甲木 × 摸鱼小李",
    installSource: localInstallSource("gzh-design-skill"),
  },
  {
    id: "tech-glossary",
    name: "技术名词解释",
    description:
      "AI 回复中出现技术名词时自动标注，点击即可查看通俗易懂的解释，专为非程序员设计。",
    repository: "https://github.com/isjiamu/tech-glossary",
    author: "CC GUI 官方",
    installSource: localInstallSource("tech-glossary"),
  },
  {
    id: "tech-glossary-mdn",
    name: "技术名词解释·MDN 术语库",
    description:
      "基于 MDN Web Docs 中文术语表的 580 条权威技术名词解释，覆盖 Web、网络、安全、编程领域，可与基础包叠加。",
    repository: "https://github.com/isjiamu/tech-glossary-mdn",
    author: "MDN Web Docs 贡献者（CC GUI 转换）",
    installSource: localInstallSource("tech-glossary-mdn"),
  },
];
