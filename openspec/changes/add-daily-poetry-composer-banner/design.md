## Context

`ChatInputBox` 当前在 component mount 时读取 `localStorage.openSourceBannerDismissed`，并把该值作为永久关闭事实；`ChatInputBoxHeader` 则直接渲染 `t("chat.openSourceBanner")`。本 change 需要替换内容选择和关闭生命周期，同时遵守 Composer render perf baseline：不能增加 timer、polling、listener 或跟随 streaming event 的 state update。

诗词是中文经典原文，不属于需要翻译的操作文案；作者与篇名随原文一起作为 curated content data。关闭按钮继续复用 `common.close` i18n key。

## Goals / Non-Goals

**Goals:**

- 以 feature-local pure helper 管理正好 30 条唯一诗词及 daily selection。
- 同一本地自然日稳定、完整周期内无重复，并规避相邻周期边界重复。
- 将 dismissal persistence 收敛到 `clientStorage`，且只对当天生效。
- 保持 banner DOM/CSS contract 和 Composer 输入性能边界。

**Non-Goals:**

- 不新增网络 API、后台任务、日期 rollover timer、设置项或跨设备同步。
- 不翻译、改写经典诗词原文。
- 不重构 `ChatInputBox` 其它职责，也不改变 banner 视觉。

## Decisions

### D1. 使用 local calendar day ordinal 作为每日 identity

helper 从 `Date#getFullYear/getMonth/getDate` 取本地日历日期，再用 `Date.UTC(year, month, date)` 生成与时刻无关的 ordinal。这样同一设备在当天任何时间都得到相同 identity，同时避免直接按毫秒除法引入时区偏移。

Alternative：使用 UTC 日期。它实现简单，但用户本地午夜前后会出现不符合“每天”的切换时间，因此不采用。

### D2. 使用固定 deterministic seeded permutation

使用产品内固定 seed 对诗词池执行一次稳定 Fisher-Yates shuffle，再以 `positiveModulo(localDayOrdinal, pool.length)` 作为每日游标。由此保证：

- 同一天返回稳定结果；
- 任意连续 `pool.length` 个自然日恰好遍历全部条目；
- 周期边界相邻两日不重复；
- 展示顺序不像固定数组遍历。

Alternative：直接 `day % pool.length`。它同样无重复，但顺序固定、随机感弱，仅保留为算法理解上的 baseline。

### D3. 诗词池与算法放在 Composer feature-local utility

新增 `ChatInputBox/utils/dailyPoetry.ts`，导出 readonly poetry pool、local date key 与 daily selector。组件只在 mount 时取当天 quote，不把日期算法和大数据常量写入 `ChatInputBox.tsx`。

Alternative：把 30 条诗词建成 i18n key。诗词原文不应翻译，且把同一份中文内容复制到 10 个 locale 会制造 drift；因此操作 copy 走 i18n，curated source content 保持单一事实源。

### D4. dismissal 使用 `clientStorage` 的当天日期

使用 `getClientStoreSync("app", "composer.dailyPoetryBannerDismissedDate")` 读取并做 exact date-key comparison；点击关闭时调用 `writeClientStoreValue` 写入当天 `YYYY-MM-DD`。任何非 string、格式损坏或非当天值都视为未关闭。

不迁移旧 `openSourceBannerDismissed=true`，因为该 key 表达已废弃的“永久隐藏”行为；继续消费它会让既有用户永远看不到新功能。

### D5. 不增加午夜 timer

“每天打开”以 component/app mount 为切换边界。应用跨午夜持续运行时不主动刷新 banner；下次打开或重新 mount Composer 时按新日期计算。该取舍避免为装饰内容引入常驻 timer 和根链 state update。

## Risks / Trade-offs

- [系统时钟被用户向前/向后调整] → 内容按当前本地日期重新计算；这是本地日历语义的预期结果，不额外持久化历史序列。
- [seeded shuffle 实现错误导致重复] → pure tests 覆盖 pool size、唯一性、same-day stability、任意完整池长区间无重复和 cycle boundary。
- [client store 未 preload 或存量值损坏] → sync read 缺失/非法时 fail open，展示 banner；dismiss write 仍更新 cache 并异步持久化。
- [诗词来源文字讹误] → 只选常见 public-domain 名句，并在 code review 中逐条保留作者与篇名。
- [移除 locale key 造成引用残留] → `rg openSourceBanner` negative scan + typecheck/locale loading tests。

## Migration Plan

1. 新增 pure helper 和 tests，先验证 selection contract。
2. 接入 `ChatInputBox` / `ChatInputBoxHeader`，使用 daily quote 与按日 dismissal。
3. 移除 10 个 locale 中废弃的 `chat.openSourceBanner` key，关闭按钮改用 `common.close`。
4. 运行 focused Vitest、typecheck、target ESLint、branding gate 与 strict OpenSpec validation。

Rollback 时可恢复旧 banner render，但不得保留两套 dismissal source of truth。新增 client-store key 是无害的孤立 string，可在后续清理中删除，无需 backend migration。

## Open Questions

无。展示内容、日界线、dismissal lifecycle 与性能边界均已在 proposal/spec 中固定。
