# Verification — fix-shared-create-default-provider-catalog

## Automated

| Check | Result |
|-------|--------|
| `vitest` initialTarget + resolveSharedSessionCreate | **14/14 pass** |
| `vitest` resolveClaudeCatalogModelLabel + resolveModelIdForIcon + mapped labels | **pass** |
| tsc 触及路径（resolve/initial/useAppShellSections/ModelSelect） | **无新增 error** |
| `openspec validate fix-shared-create-default-provider-catalog --strict` | **pass** |

## Follow-up 修复记录

| 现象 | 修复 |
|------|------|
| 创建：chip 本地 + 过期 MiniMax 列表 | 第一 Provider + local `forceRefresh` / managed scoped catalog |
| 打开历史：chip 对、文案串 managed | catalog `model.model` 优先；hydrate ensure 时 Claude sync mapping |
| 打开历史：文案 k3、图标 DeepSeek 鲸 | `resolveModelIdForIcon` 与文案同源；`k3` 短 id → kimi 品牌 |

## Manual checklist

- [x] Shared 侧栏创建 Claude：默认第一 Provider；模型与切渠道一致
- [x] 打开历史 Shared：chip 与列表 runtime 一致（用户验收：文案 OK）
- [x] 列表图标与 runtime 品牌一致（用户验收：图标 OK）
- [x] 打开旧 Shared：回显 last target，不被创建默认覆盖（契约 + 代码只 create 调 resolve）
- [x] 创建/打开后会话内切渠道：既有行为保留

## 文档

- Analysis：`docs/analysis/shared-create-local-catalog-stale-mapping-2026-08-08.md`
- OpenSpec change：`openspec/changes/fix-shared-create-default-provider-catalog/`
