import type { CSSProperties } from "react";
import { providerBrandIconThemeStrategy } from "../providerBrandIcon";

/**
 * 供应商品牌图标 <img> 统一渲染出口。
 *
 * kimi-color.svg 等「白字 + 彩色点」图标是为深色品牌底设计的：在浅色背景下
 * 白色主体几乎看不见，只剩蓝点。这里不依赖 settings 懒加载 CSS，直接用
 * 内联样式铺深色底衬，保证 composer 模型选择器 / 设置页都能正确显示。
 */
const BASE_ICON_STYLE: CSSProperties = {
  display: "block",
  width: 16,
  height: 16,
  maxWidth: "100%",
  maxHeight: "100%",
  objectFit: "contain",
  flexShrink: 0,
};

const DARK_TILE_STYLE: CSSProperties = {
  ...BASE_ICON_STYLE,
  background: "#0d0d0d",
  borderRadius: 3,
  // border-box：padding 吃在固定宽高内，避免 18px 容器被撑破或内容被压扁
  boxSizing: "border-box",
  padding: 2,
};

export function ProviderBrandIconImg({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const themeStrategy = providerBrandIconThemeStrategy(src);
  const needsDarkTile = themeStrategy === "dark-tile";
  const classes = [
    "vendor-brand-icon-img",
    themeStrategy === "mono-adaptive" ? "vendor-brand-icon-img--mono-adaptive" : null,
    needsDarkTile ? "vendor-brand-icon-tile" : null,
    className?.trim() || null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      className={classes}
      style={needsDarkTile ? DARK_TILE_STYLE : BASE_ICON_STYLE}
    />
  );
}
