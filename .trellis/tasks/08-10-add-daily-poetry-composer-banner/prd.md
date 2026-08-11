# Composer 每日经典诗词提示

## Goal

将 Composer 顶部固定的开源提示替换为每日轮换的正能量经典中国诗词片段，并让关闭仅对当天生效。

关联 OpenSpec change：`add-daily-poetry-composer-banner`。

## Requirements

- 内置正好 30 条唯一诗词片段，包含作者与篇名。
- 同一本地自然日显示同一句，跨日轮换。
- 连续 30 天不重复，第 31 天开始新一轮 30 天循环，周期边界相邻两天也不重复。
- 当天关闭后隐藏，下一自然日重新展示。
- 复用既有 banner 布局，关闭按钮使用 i18n accessible name。
- 不引入网络、timer、polling、listener 或 streaming hot-path update。

## Acceptance Criteria

- [x] 诗词池数量、字段完整性与唯一性有 unit test。
- [x] same-day、full-cycle、cycle-boundary selection 有 deterministic unit test。
- [x] dismissal 的 today / next-day / malformed value 行为有 test。
- [x] banner render 和 localized close interaction 有 focused component test。
- [x] 不再存在 `chat.openSourceBanner` 运行时引用。
- [x] focused Vitest、typecheck、target ESLint 与 OpenSpec strict validation 通过。

## Technical Notes

- Feature slice：`src/features/composer/components/ChatInputBox/**`。
- Pure helper：local date key + seeded permutation selector。
- Persistent state：`clientStorage` 的 `app / composer.dailyPoetryBannerDismissedDate`。
- 既有 `localStorage.openSourceBannerDismissed` 不迁移，因为它承载的是被移除的永久关闭语义。
