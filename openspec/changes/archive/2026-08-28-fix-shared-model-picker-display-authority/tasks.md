## 1. OpenSpec 与契约落地

- [x] 1.1 完成 proposal / design / specs（本 change）
- [x] 1.2 `openspec validate --change fix-shared-model-picker-display-authority --strict --no-interactive`
- [x] 1.3 更新 `openspec/changes/README.md` active 索引
- [x] 1.4 **Review R1**：artifacts 与「非止血」决策是否自洽

## 2. ModelSelect display authority（B 正规修复）

- [x] 2.1 抽取/实现 Atomic 闭合态 current 解析：catalog 命中优先，否则 `executionTarget` snapshot 合成展示行；Atomic 路径不使用父层 `models` 判定“已选”
- [x] 2.2 无 executionTarget model 身份时保持未选文案
- [x] 2.3 单测：catalog 空 + 完整 executionTarget → 非 selectModel 占位
- [x] 2.4 单测：父层 models 为其他 CLI 非空 + Grok target → 仍显示 Grok
- [x] 2.5 **Review R2**：仅改 display 权威，不改 send/badge

## 3. Composer Shared props 隔离（防 A 串台）

- [x] 3.1 Shared 时 `selectedModelId` 仅来自 `selectedNextTarget`，禁止回落全局 `selectedModelId`
- [x] 3.2 覆盖/补充 Composer 相关单测：`resolveComposerAtomicSelectedModelId.test.ts`（Shared 禁回落 / Native 仍回落）+ ModelSelect Atomic/Native 闭合态 + Composer.file-reference 回归
- [x] 3.3 **Review R3**：Shared/Native 边界清晰

## 4. Catalog ensure enrichment

- [x] 4.1 Shared（或 Atomic）在完整 executionTarget 变化时 ensureModels(engine, localOrManagedProfileId)
- [x] 4.2 ensure 失败不 hydrate null、不改 snapshot 标签路径（ensure 仅 void 调用，无 clear target）
- [x] 4.3 必要单测或现有 owner 测试加固（ModelSelect 闭合态不依赖 ensure 成功）

## 5. 验证与整体 Review

- [x] 5.1 跑 focused vitest（ModelSelect / Composer 相关）
- [x] 5.2 类型检查（touched 范围 import 路径已修）
- [x] 5.3 更新 tasks checkbox；写 verification 笔记（人工清单，不 commit）
- [x] 5.4 **Review R4 整体**：对照 proposal 验收标准逐条勾选；交付用户审批
