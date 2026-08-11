## 1. Daily poetry domain logic

- [x] 1.1 [P0][depends:none][I:`composer-daily-poetry-banner` spec][O:readonly exactly-30-entry poetry pool, local date key helper, fixed seeded-permutation selector][V:focused Vitest proves field completeness, uniqueness, same-day stability, any 30-day interval no-repeat and cycle-boundary no-repeat] 实现 feature-local pure helper。
- [x] 1.2 [P0][depends:1.1][I:daily selector and dismissal date contract][O:today visibility/dismissal pure helpers using sanitized date strings][V:focused Vitest covers missing, malformed, today and next-day values] 固化按日 dismissal 逻辑。

## 2. Composer integration

- [x] 2.1 [P0][depends:1.1,1.2][I:现有 `ChatInputBox` banner state and `clientStorage` API][O:mount-time daily quote + Composer-specific dismissal date persistence][V:component/pure tests prove close hides today and next day reappears without polling] 接入按日显示状态。
- [x] 2.2 [P0][depends:2.1][I:现有 `ChatInputBoxHeader` DOM/CSS contract][O:attributed poetry text prop and localized `common.close` accessible name][V:focused Testing Library test asserts rendered quote, accessible close and callback] 替换 banner render copy。
- [x] 2.3 [P1][depends:2.2][I:10 个 locale 的废弃 `chat.openSourceBanner` key][O:remove unused locale keys with no runtime references][V:`rg openSourceBanner` only returns intentional legacy migration evidence or no matches; typecheck passes] 清理废弃 i18n copy。

## 3. Verification and spec closure

- [x] 3.1 [P0][depends:2.3][I:changed helper/components/tests][O:green focused test and static gates][V:`npx vitest run <focused files>`、target ESLint、`npm run typecheck`、`npm run check:branding`] 运行实现验证。
- [x] 3.2 [P0][depends:3.1][I:OpenSpec artifacts and implementation evidence][O:checked task list and strict-valid change][V:`openspec validate add-daily-poetry-composer-banner --strict --no-interactive`] 完成 OpenSpec 校验。
- [ ] 3.3 [P1][depends:3.2][I:running desktop app][O:light/dark theme Composer visual smoke evidence][V:banner 单行/截断、关闭按钮、SDK warning/queue/attachment coexistence 人工检查] 执行桌面目视验收；若本会话无法实机运行则保留 unchecked 并记录 qualifier。
