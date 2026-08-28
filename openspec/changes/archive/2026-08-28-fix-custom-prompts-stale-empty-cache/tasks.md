## 1. Hook: soft-failure 与 in-flight 共享

- [x] 1.1 重构 `useCustomPrompts.refreshPrompts`：记录 fallback `failedReason`，soft-cancel（`stale`/`cancelled`）保留现有列表且不 stamp `lastFetchedWorkspaceId`
- [x] 1.2 硬失败（`timeout` 等）不 stamp 成功拉取；有旧列表则保留；可选去重 error toast
- [x] 1.3 权威成功 settle 才 `setPrompts` + stamp `lastFetchedWorkspaceId` + 清 error
- [x] 1.4 将 `inFlight` boolean 改为 shared Promise；重叠调用 await 同一任务；成功时 resolve 当前列表（供 `!` revalidate）

## 2. Composer `!` 空态 revalidate

- [x] 2.1 将 `refreshPrompts`（或返回列表的 callback）从 app-shell → Composer → ChatInputBoxAdapter 透传（最小链路）
  - 采用 `promptEvents.requestCustomPromptsRefresh` 注册表，避免全链路 prop drilling，兼容双 hook 实例
- [x] 2.2 `promptCompletionProvider` 在 `prompts.length === 0` 且 workspace 可用时 `await` on-demand refresh，用返回值构建当次 dropdown
- [x] 2.3 非空内存路径保持只读 props，不强制 IPC；权威空 settle 用 `skipIfAuthoritative` 跳过 IPC

## 3. i18n 与测试

- [x] 3.1 增加 `promptsListUnavailableTitle/Message`（en/zh 及其余 chat locales）
- [x] 3.2 扩展 `useCustomPrompts.test.tsx`：soft-cancel 保留、hard fail toast、shared inFlight、skipIfAuthoritative
- [x] 3.3 扩展 Adapter 测试：空态 revalidate 展示刷新后的 prompts；非空不 revalidate
- [x] 3.4 运行相关 Vitest；`openspec validate` change

## 4. 收口

- [x] 4.1 勾选 tasks 完成项
- [x] 4.2 换角度 review（竞态、双实例、真·空列表、兼容性）
