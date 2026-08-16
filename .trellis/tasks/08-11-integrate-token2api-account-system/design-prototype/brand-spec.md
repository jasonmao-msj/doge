# Doge · Prototype Brand Spec

> 采集日期：2026-08-15
> 资产完整度：完整（原型范围）

## 核心资产

- Doge mascot：`../../../../src/assets/brand/doge-mascot-avatar.png`
- Codex logo：`../../../../public/brand-logos/codex.svg`
- Claude Code logo：`../../../../public/brand-logos/claude-code.svg`

## 视觉约束

- 沿用当前 Doge 的 zinc-neutral surface、黑白 primary 与 success green。
- 不新增紫色渐变、营销插画、装饰性数据卡或无语义 icon。
- 页面只保留任务标题、必要字段和一个主操作；说明进入自适应 tooltip。
- 圆角保持 8–14px，列表与选择面使用细边框，不使用厚重大黑选中卡。
- 浅色与深色模式都使用实色 surface，保证桌面 WebView 中的稳定对比度。

## 原型演示数据

- 套餐名称、价格、额度均为界面占位，不代表 token-matrix.com 正式商业配置。
- 正式实现必须完全由 token2api 登录态接口返回，并在购买前展示实际成交金额。
