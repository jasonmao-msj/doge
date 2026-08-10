/**
 * 供应商品牌图标解析:baseUrl host → 品牌 SVG,model id 兜底,都不命中返回 null(调用方用 Globe 兜底)。
 * 映射与 reference desktop client webview/src/utils/modelIconMapping.ts 对齐,仅保留本项目预设涉及的品牌。
 */
import anthropicIcon from "@lobehub/icons-static-svg/icons/anthropic.svg";
import bailianIcon from "@lobehub/icons-static-svg/icons/bailian-color.svg";
import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg";
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import longcatIcon from "@lobehub/icons-static-svg/icons/longcat-color.svg";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import moonshotIcon from "@lobehub/icons-static-svg/icons/moonshot.svg";
import opencodeIcon from "@lobehub/icons-static-svg/icons/opencode.svg";
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg";
import openrouterIcon from "@lobehub/icons-static-svg/icons/openrouter-color.svg";
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import xiaomimimoIcon from "@lobehub/icons-static-svg/icons/xiaomimimo.svg";
import zhipuIcon from "@lobehub/icons-static-svg/icons/zhipu-color.svg";

export type ProviderBrandVendor =
  | "claude"
  | "openai"
  | "zhipu"
  | "kimi"
  | "moonshot"
  | "deepseek"
  | "minimax"
  | "xiaomi"
  | "bailian"
  | "longcat"
  | "opencode"
  | "openrouter";

export const PROVIDER_BRAND_ICON_SRC: Record<ProviderBrandVendor, string> = {
  claude: claudeIcon,
  openai: openaiIcon,
  zhipu: zhipuIcon,
  kimi: kimiIcon,
  moonshot: moonshotIcon,
  deepseek: deepseekIcon,
  minimax: minimaxIcon,
  xiaomi: xiaomimimoIcon,
  bailian: bailianIcon,
  longcat: longcatIcon,
  opencode: opencodeIcon,
  openrouter: openrouterIcon,
};

export const ANTHROPIC_BRAND_ICON_SRC = anthropicIcon;
export const QWEN_BRAND_ICON_SRC = qwenIcon;

/**
 * 白色主体字形、为深色品牌底设计的图标(当前仅 kimi-color.svg:白 K + 蓝点)。
 * 直接铺在浅色背景上主体不可见,渲染时需深色底衬瓦片(.vendor-brand-icon-tile)。
 */
const DARK_TILE_BRAND_ICON_SRCS: ReadonlySet<string> = new Set([kimiIcon]);

/** 判断品牌图标是否需要深色底衬瓦片(浅色背景下白色主体字形不可见的图标) */
export function providerBrandIconNeedsDarkTile(src: string): boolean {
  return DARK_TILE_BRAND_ICON_SRCS.has(src);
}

/** baseUrl host → 品牌(顺序即优先级,先命中先返回) */
const BASE_URL_VENDOR_PATTERNS: ReadonlyArray<
  readonly [RegExp, ProviderBrandVendor]
> = [
  [/bigmodel\.cn/i, "zhipu"],
  [/moonshot\.(cn|ai)|kimi\.com/i, "kimi"],
  [/deepseek\.com/i, "deepseek"],
  [/minimaxi\.com|minimax\.(io|com)/i, "minimax"],
  [/xiaomimimo\.com/i, "xiaomi"],
  [/dashscope\.aliyuncs\.com/i, "bailian"],
  [/longcat\.chat/i, "longcat"],
  [/opencode\.ai/i, "opencode"],
  [/openrouter\.ai/i, "openrouter"],
  [/anthropic\.com|claude\.ai/i, "claude"],
  [/api\.openai\.com/i, "openai"],
];

/** model id → 品牌兜底匹配 */
const MODEL_VENDOR_PATTERNS: ReadonlyArray<
  readonly [RegExp, ProviderBrandVendor]
> = [
  [/qwen/i, "bailian"],
  [/deepseek/i, "deepseek"],
  [/kimi/i, "kimi"],
  // Moonshot Coding 短 id（ANTHROPIC 映射常见 k3 / k3-256k），须在宽泛规则前命中
  [/^k3(?:-[\w.]+)?$/i, "kimi"],
  [/moonshot/i, "moonshot"],
  [/glm|chatglm|zhipu/i, "zhipu"],
  [/minimax/i, "minimax"],
  [/xiaomi|mimo/i, "xiaomi"],
  [/longcat/i, "longcat"],
  [/opencode/i, "opencode"],
  [/claude|anthropic/i, "claude"],
  [/gpt[-\s]|^gpt\d|^o[134]\b|openai/i, "openai"],
];

/** 预设 id → 品牌(预设内 baseUrl 即品牌身份,直接映射最稳) */
const PRESET_VENDOR_MAP: Record<string, ProviderBrandVendor> = {
  official_direct: "claude",
  zhipu: "zhipu",
  kimi: "kimi",
  "kimi-coding": "kimi",
  deepseek: "deepseek",
  minimax: "minimax",
  xiaomi: "xiaomi",
  "xiaomi-plan": "xiaomi",
  bailian: "bailian",
  "bailian-coding": "bailian",
  longcat: "longcat",
  "opencode-go": "opencode",
  openrouter: "openrouter",
};

export function resolveVendorFromBaseUrl(
  baseUrl?: string | null,
): ProviderBrandVendor | null {
  if (!baseUrl) return null;
  for (const [pattern, vendor] of BASE_URL_VENDOR_PATTERNS) {
    if (pattern.test(baseUrl)) return vendor;
  }
  return null;
}

export function resolveVendorFromModelId(
  modelId?: string | null,
): ProviderBrandVendor | null {
  if (!modelId) return null;
  for (const [pattern, vendor] of MODEL_VENDOR_PATTERNS) {
    if (pattern.test(modelId)) return vendor;
  }
  return null;
}

/**
 * 解析供应商品牌图标 SVG src。
 * 优先级:baseUrl host > model id > preset id;都不命中返回 null(调用方渲染 Globe 兜底)。
 */
export function resolveProviderBrandIcon(input: {
  baseUrl?: string | null;
  modelId?: string | null;
  presetId?: string | null;
}): string | null {
  const fromUrl = resolveVendorFromBaseUrl(input.baseUrl);
  if (fromUrl) return PROVIDER_BRAND_ICON_SRC[fromUrl];
  const fromModel = resolveVendorFromModelId(input.modelId);
  if (fromModel) return PROVIDER_BRAND_ICON_SRC[fromModel];
  if (input.presetId) {
    const fromPreset = PRESET_VENDOR_MAP[input.presetId];
    if (fromPreset) return PROVIDER_BRAND_ICON_SRC[fromPreset];
  }
  return null;
}
