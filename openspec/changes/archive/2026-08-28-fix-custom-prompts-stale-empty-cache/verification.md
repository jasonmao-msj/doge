# Verification: fix-custom-prompts-stale-empty-cache

## Automated

| Check | Result |
| ----- | ------ |
| `openspec validate fix-custom-prompts-stale-empty-cache --strict` | pass |
| `pnpm vitest run src/features/prompts/hooks/useCustomPrompts.test.tsx src/features/composer/components/ChatInputBox/ChatInputBoxAdapter.test.tsx` | 70 passed |
| `pnpm vitest run src/i18n/locales/chatLocaleMerge.test.ts src/i18n/locales/multiAgentLocaleParity.test.ts` | 19 passed |

## Manual smoke (recommended)

1. 冷启动进入已有自定义提示词的 workspace，不打开设置
2. 输入 `!`：应列出既有提示词（若启动阶段曾 soft-fail，当次 revalidate 后应恢复）
3. 删除全部提示词后权威空：`!` 显示「暂无提示词」+ 创建，不应每次键入狂打 IPC
4. 创建一条后设置页与 `!` 菜单一致
5. 快速切换 workspace 时列表不应被 soft-cancel 永久清空

## Cross-angle review notes

见会话收口中的「换角度 Review」段。
