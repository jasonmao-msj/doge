/**
 * LLM Token 数量的全局展示格式。
 * 单位固定为 K / M / B，不跟随 UI locale，避免出现“万 / 亿”等区域化缩写。
 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return formatUnit(value / 1_000, "K", 1);
  if (value < 1_000_000_000) return formatUnit(value / 1_000_000, "M", 1);
  return formatUnit(value / 1_000_000_000, "B", 2);
}

function formatUnit(value: number, suffix: "K" | "M" | "B", decimals: number): string {
  const precision = value >= 100 ? 0 : decimals;
  return `${Number(value.toFixed(precision)).toString()}${suffix}`;
}
