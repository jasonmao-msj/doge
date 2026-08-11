# Verification

Date: 2026-08-10

## Automated evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Focused Vitest | PASS | 3 files / 13 tests：exactly-30 poetry pool + 30-day rotation、clientStorage adapter、Header render / accessible close |
| Target ESLint | PASS with existing warnings | 0 errors；`ChatInputBox.tsx` 仅保留 2 条 pre-existing `react-hooks/exhaustive-deps` warning |
| `npm run lint` | PASS with baseline warnings | 0 errors / 16 existing warnings；无本 change 新增 warning |
| `npm run typecheck` | PASS | `tsc --noEmit` exit 0 |
| `npm run test` | PASS | batched suite completed all 1078 test files |
| `npm run check:branding` | PASS | canonical identity and legacy-service scan clean |
| `npm run check:large-files` | PASS (report mode) | exit 0；输出仅含 repository baseline inventory |
| Negative scan | PASS | `rg 'openSourceBanner\|open-source-banner\|openSourceBannerDismissed' src` 无匹配 |
| OpenSpec strict validation | PASS | `openspec validate add-daily-poetry-composer-banner --strict --no-interactive` |

## Browser smoke

本地 `http://localhost:1420/` Vite 页面成功启动并加载 production component tree：

- `.daily-poetry-banner` DOM 存在；初版 smoke 已证明 attributed content 正常进入 production component tree。扩充为 30 条后，deterministic selector 对 2026-08-10 输出 `“天生我材必有用，千金散尽还复来。” —— 李白《将进酒》`，并由 focused test 锁定 30 条与 30 日无重复 contract。
- `.banner-close` 的 `aria-label` 为 `关闭`。
- 当前 browser client store 没有 workspace，页面只能进入 Home Composer；既有 `home-chat.css` 明确隐藏该 banner，因此会话页 visible layout、light/dark 与 queue/attachment coexistence 的桌面目视项未完成，保留 `tasks.md` 3.3 unchecked。
- visible render / close callback / SDK warning coexistence 已由 `ChatInputBoxHeader.test.tsx` 自动覆盖；本报告不把它冒充为完整 Tauri visual QA。

## Scope qualifiers

- 无 backend、Tauri command、API、database、engine registry 或 Shared runtime contract 变更。
- 未命中 ADR calibration writeback trigger。
- 未执行 commit；本 change 未编辑其它 active OpenSpec change 的 artifacts。
