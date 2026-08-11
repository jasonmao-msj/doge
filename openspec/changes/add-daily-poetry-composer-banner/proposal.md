## Why

Composer 顶部当前固定展示“100% 开源”提示，并且用户关闭后会永久隐藏；这既没有持续的信息价值，也无法满足每天打开应用获得一条正向经典诗词的体验目标。需要把该区域改造成无网络依赖、每日稳定轮换且尽量不重复的中国古典诗词提示。

## What Changes

- 将 Composer 顶部固定的开源提示替换为带作者与篇名的经典中国诗词片段，内容选择以积极、进取、豁达为主。
- 内置正好 30 条互不重复的诗词片段，不依赖远端 API。
- 按用户本地自然日确定当天内容：同一天重复打开保持同一句，跨日切换，并在完整轮换周期内不重复。
- 将关闭状态从“永久隐藏”改成“仅隐藏当天”，次日打开 Composer 时重新展示当天诗词。
- 保留既有 banner 的布局和关闭交互，并补充可访问名称与 focused tests。

## 目标与边界

### 目标

1. 用户每天首次打开 Composer 时看到一条当天稳定的经典诗词片段。
2. 连续 30 个自然日不重复，第 31 天开始新一轮 30 天循环。
3. 当天关闭后不再打扰，下一自然日恢复展示。
4. 选择逻辑可独立测试，不向 Composer 根链增加 polling、listener 或高频 state update。

### 边界

- 使用客户端本地日期，不要求跨设备或跨时区同步同一句。
- 诗词内容作为不可翻译的中文经典原文展示；关闭按钮等交互 copy 继续使用 i18n。
- 仅调整现有 Composer banner，不新增独立卡片、设置项或通知中心入口。

## 非目标

- 不接入网络诗词 API、账号服务、云同步或 telemetry。
- 不允许用户编辑诗词池、收藏、分享或切换主题。
- 不改变 Composer 输入、发送、附件、队列、SDK warning 等既有行为。
- 不在本 change 重设计 banner 视觉样式。

## 技术方案对比

| 方案 | 描述 | 优点 | 风险 | 结论 |
| --- | --- | --- | --- | --- |
| A. 每次启动纯随机抽取 | `Math.random()` 从诗词池选择 | 实现最少 | 同一天不稳定，连续重复概率高，测试不可复现 | 不采用 |
| B. 日期直接取模 | 以 local day ordinal 对诗词池长度取模 | 完全稳定、无重复 | 顺序固定，随机感弱 | 可作为 fallback，不作为主方案 |
| C. 固定 seeded shuffle + 日期游标 | 以固定 seed 将诗词池生成稳定 permutation，再用 local day ordinal 推进游标 | 同日稳定、任意连续一个池长区间均无重复、顺序具有随机感、可测试 | 新增诗词时会形成新的顺序 | 采用 |

关闭状态使用现有 `clientStorage` 持久化当天的 `YYYY-MM-DD`，读取时做 string validation；旧的永久关闭 key 不再作为新行为的 source of truth。

## Capabilities

### New Capabilities

- `composer-daily-poetry-banner`: Composer 每日诗词内容池、按本地自然日确定性轮换与按日关闭恢复合同。

### Modified Capabilities

<!-- None. -->

## Impact

- Frontend：`src/features/composer/components/ChatInputBox/**` 的 banner state、render props 与 feature-local poetry helper/tests。
- Localization：移除各 locale 已废弃的 `chat.openSourceBanner` copy；关闭按钮复用 `common.close`。
- Storage：新增 domain-specific `clientStorage` key，仅保存当天关闭日期；不涉及 backend schema 或 migration。
- Dependencies / APIs：无新增依赖、无 Tauri command、无 cross-layer payload 变更。

## 验收标准

1. 诗词池正好包含 30 条唯一片段，每条包含原文、作者与篇名。
2. 同一本地自然日无论时间如何变化均返回同一条诗词；连续 30 天不重复，第 31 天进入新一轮循环。
3. 周期交界的相邻两天也不显示相同诗词。
4. 当天点击关闭后该日不再显示；下一本地自然日重新显示。
5. banner 保持既有布局，关闭按钮使用 i18n 可访问名称，SDK warning / queue / attachments rendering 不回归。
6. focused Vitest、`npm run typecheck`、target ESLint 与 `openspec validate add-daily-poetry-composer-banner --strict --no-interactive` 通过。
