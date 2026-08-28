## 1. OpenSpec 与契约

- [x] 1.1 完成 proposal / design / specs（本 change）
- [x] 1.2 `openspec validate fix-shared-create-default-provider-catalog --strict --no-interactive`（pass）
- [x] 1.3 更新 `openspec/changes/README.md` active 索引
- [x] 1.4 **Review R1**：创建默认第一 Provider vs open 回显 last 边界清晰

## 2. 创建入口：首 Provider + 权威 catalog

- [x] 2.1 抽取/实现 Shared 创建解析：给定 engine → 有序 profiles 第一项
- [x] 2.2 按 profile 调用 `getEngineModels`：local 带 sentinel + `forceRefresh: true`；managed 带 profileId
- [x] 2.3 替换 `handleStartSharedConversation` 中裸 `getEngineModels(sharedEngine)` + 写死本地 builder 调用
- [x] 2.4 扩展 `buildLocalSharedSessionInitialTarget` 或新增 `buildSharedSessionInitialTarget` 支持 managed/local 完整 snapshot
- [x] 2.5 Claude 创建默认 profile 调用 `syncClaudeModelMappingForProfile`（失败不阻断）
- [x] 2.6 单测：create 参数含 forceRefresh/profileId；第一 profile 为 managed 时 snapshot 非「本地配置」误标；空 catalog fail-closed

## 3. 打开既有会话不 reseed + 展示对齐

- [x] 3.1 确认 activate/hydrate 路径不调用 create 默认解析
- [x] 3.2 打开历史：Claude sync mapping + 文案/图标 catalog runtime 优先
- [x] 3.3 `k3` 短 id 品牌 → kimi；单测 resolveClaudeCatalogModelLabel / resolveModelIdForIcon
- [x] 3.4 **Review R2**：create / open 分叉 + 展示同源

## 4. 验证

- [x] 4.1 focused vitest（initialTarget / resolve create / ModelSelect label+icon）
- [x] 4.2 手工清单：用户验收文案 + 图标通过（见 verification.md）
- [x] 4.3 文档：analysis + design D7/D8 + verification；单独 Conventional Commit

## 5. 整体 Review

- [x] 5.1 对照 proposal 验收标准逐条
- [x] 5.2 **Review R4** 换角度 review + verification
