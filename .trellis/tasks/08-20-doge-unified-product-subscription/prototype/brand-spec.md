# Doge unified subscription prototype · Brand Spec

> 采集日期：2026-08-20
>
> 资产来源：Doge 当前仓库与用户提供的现有 UI 截图
>
> 资产完整度：完整（本原型范围）

## 核心资产

- App icon：`../../../../public/app-icon.png`
- Codex engine icon：`../../../../src/assets/model-icons/openai.svg`
- Claude engine icon：`../../../../src/assets/model-icons/claude.svg`
- OpenAI model icon：`../../../../src/assets/model-icons/openai.svg`
- Claude model icon：`../../../../src/assets/model-icons/claude.svg`
- 豆包 model icon：`../../../../src/assets/model-icons/doubao.png`

## 视觉系统

- 结构：复用 Doge desktop 的左侧导航、中央对话区与底部 composer。
- 深色背景：`#0d0f13` / surface `#15171c` / border `#2b2f37`。
- 浅色背景：`#f7f7f8` / surface `#ffffff` / border `#dedfe3`。
- Accent：仅用于选中与主动作的 `#2f7df4`；订阅完成状态使用 `#22b982`。
- 字体：仓库构建产物中的 Geist Variable；中文回退为 PingFang SC。
- 圆角：面板 14px、列表 10px、按钮 9px；避免大面积胶囊与装饰卡片。
- Motion：组合面板 180ms 横向进入；engine / model 选择立即生效，面板保持打开以支持连续切换。

## 交互原则

- 商业入口只有一个 Doge 套餐，不展示 engine / model 单独购买。
- model picker 同屏完成 engine 与 model 两个独立单选。
- engine 来自 Doge 本地 registry，model 来自套餐的上游统一 catalog；二者互不筛选、互不重置。
- composer 同时展示 engine icon、model icon 与 model display name。
- 原型只定义信息架构；账号生命周期、安全能力和视觉细节以现有 Doge 成熟实现为主。
