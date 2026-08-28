# Verification — fix-shared-model-picker-display-authority

## Automated

| Check | Result |
|-------|--------|
| `openspec validate fix-shared-model-picker-display-authority --strict --no-interactive` | pass |
| `vitest run .../ModelSelect.test.tsx` | pass (含 Shared + Native Atomic 闭合态) |
| `vitest run .../resolveComposerAtomicSelectedModelId.test.ts` | pass |
| `vitest run .../Composer.file-reference-token.test.tsx` | pass |
| `tsc` filtered on touched files | no remaining errors after import path fix |

## Native CLI impact matrix

| 点 | Native 是否同源问题 | 本次是否改到 | 影响 |
|----|---------------------|--------------|------|
| 闭合态标签依赖 catalog 命中 | **相似**：Atomic 空 catalog 时曾假空 | **是**（共用 `resolveAtomicSelectedModelDisplay`） | 有 modelCatalogEntryId 时闭合态更稳，属顺带修复 |
| 权威源 | Native 用 `nativeSessionTarget` + per-thread selectedModelId，不是 shared store | Shared 禁全局回落 **仅** `isSharedSession` | **不破坏** Native 回落全局 selectedModelId |
| send / 续接 | Native 续接路径独立 | **未改** handler 分叉 | 无 |
| catalog ensure | Native Atomic 也会 ensure current profile | **是**（ChatInputBox effect） | 额外拉 catalog，有 cache；不改 selection |
| nativeAtomicSelection | 点选即时投影 | **未改** | 无 |

## Acceptance vs proposal

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Shared complete target, menu not opened → non-empty model label | code + unit (Grok empty catalog) |
| 2 | Parent models wrong engine non-empty → still show target | unit covered |
| 3 | Shared null target → unselected; no global selectedModelId borrow | Composer props + unit |
| 4 | Send/Badge authority unchanged | design non-goals; no send path edits |
| 5 | Menu catalog still works | existing atomic tests still green |
| 6 | No git commit | **not committed** — user approval |

## Manual smoke (user)

1. 新建 Shared Session 初始 Grok 本地配置：底栏应显示 `grok`（或 catalog 名），非「选择模型」。
2. 发送一轮：Badge 与底栏一致；切换到另一 Shared 再切回：底栏恢复该会话 target。
3. Shared 内切 Claude managed：渠道列表正确；不弹 Native 续接。
4. 故意清空/不完整 target 的老会话：显示未选，不能误显示全局 Native 模型。

## Review stages

- **R1** OpenSpec artifacts：valid
- **R2** ModelSelect snapshot authority：tests green
- **R3** Composer Shared isolation + ensure：landed
- **R4** overall：见上表；待用户实机冒烟与审批
