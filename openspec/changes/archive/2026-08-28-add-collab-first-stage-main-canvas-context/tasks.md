## 1. OpenSpec / 契约

- [x] 1.1 proposal / design / specs 落盘
- [x] 1.2 `openspec validate add-collab-first-stage-main-canvas-context --strict`

## 2. 实现

- [x] 2.1 新增 `injectMainCanvasContext` 纯函数（过滤、cap、头部拼接）
- [x] 2.2 单测：有历史 / 空历史 / 内部标记过滤 / cap / 不污染 user 原文语义
- [x] 2.3 `useThreadMessaging` squad 路径接入：用 `itemsByThread[threadId]` 注入，且只改 `modelText`
- [x] 2.4 主幕卡/终态锚点标题改用 `collabDisplayTitle`（`userVisibleText` 优先，剥离 digest）
- [x] 2.5 右栏「注入上下文」增加 `mainCanvas` 分区（仅首段）+ i18n + CSS
- [x] 2.6 接入被冲掉后重接 + 显示修复一次性收口

## 3. 验证

- [x] 3.1 focused Vitest 通过（mainCanvas + buildStageInject + i18n scan）
- [x] 3.2 自检：visibleText 路径无 digest；主幕标题无标记；右栏有主幕分区
- [x] 3.3 请用户验收（**不提交**）
