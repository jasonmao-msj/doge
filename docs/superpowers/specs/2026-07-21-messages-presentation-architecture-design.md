# Messages Presentation Architecture Design

> **Lifecycle**：historical mirror；canonical change 已归档。
> **Canonical design**：`openspec/changes/archive/2026-07-21-refactor-messages-presentation-architecture/design.md`。

本设计已由用户确认，采用 behavior-preserving gradual domain decomposition：

- Scope：`Messages.tsx`、`MessagesTimeline.tsx`、`MessagesRows.tsx` 及 direct helpers。
- Architecture：compatibility façade + `orchestration / timeline / rows`。
- Interface：七类 typed view models，stable snapshot 与 high-frequency live lane 分离。
- Constraints：不改 UI/DOM/CSS/i18n/Markdown/toolBlocks/runtime contract，不新增 dependency/mega Context。
- Verification：focused messages tests + full frontend gates + OpenSpec strict validation。

完整 rationale、风险、依赖方向和验证记录以 canonical OpenSpec archive 为准，避免双份设计事实源漂移。
