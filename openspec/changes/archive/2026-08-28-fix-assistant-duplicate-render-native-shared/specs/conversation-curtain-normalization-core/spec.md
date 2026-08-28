## MODIFIED Requirements

### Requirement: Assistant Settlement Canonicalization MUST Collapse Equivalent Replay

conversation curtain 对 assistant reply 的 completed settlement MUST 能收敛 `stream delta`、`completed replay`、`history hydrate` 等多来源中的等价正文，避免主体文本重复拼接。该收敛 MUST 对 `Codex`、`Claude Code` 与 `Gemini` 生效，且 MUST 在 **Native 与 Shared** 会话上一致；provider-specific completion carrier 不得绕过 shared assistant comparator。收敛范围 MUST 包含：精确双份、`prefix + full` 回放、以及 **更长稿之后的 early-body 回显**（`A2` 后再附带 `A`）。

#### Scenario: completed replay with streamed prefix converges before history refresh

- **WHEN** assistant 已通过 realtime delta 显示了可读正文前缀
- **AND** terminal completed payload 又以 `prefix + full final snapshot` 或等价 replay 形式到达
- **THEN** 系统 MUST 在本地 settlement 阶段将该 replay 收敛为单条 assistant message
- **AND** MUST NOT 依赖后续 history refresh 才去掉重复正文

#### Scenario: short duplicate reply renders once

- **WHEN** 任一支持引擎对简短输入返回短句型回复
- **AND** stream / completed / history 三种来源中存在等价重复
- **THEN** 最终幕布 MUST 只显示一条 assistant reply
- **AND** MUST NOT 出现整句重复拼接

#### Scenario: claude long markdown completion does not append final snapshot twice

- **WHEN** `Claude Code` 正在 streaming 长 Markdown
- **AND** terminal completion 或 history hydrate 提供等价 full Markdown snapshot
- **THEN** shared assistant settlement MUST replace or canonicalize the live row
- **AND** MUST NOT 将 streamed prefix 与 final snapshot 重复拼接

#### Scenario: longer snapshot then early-body echo does not double body

- **WHEN** live or completed assistant text already holds a longer readable draft
- **AND** an incoming snapshot or completed payload appends or embeds a replay of the early body after that draft
- **THEN** settlement MUST collapse to one readable draft in conversation state
- **AND** this MUST hold for Native and Shared sessions using the shared merge helpers

#### Scenario: gemini assistant replay stays canonical

- **WHEN** `Gemini` streaming output 与 history hydrate output 在 normalized text 后等价
- **THEN** 系统 MUST 保留一条 canonical assistant message
- **AND** history hydrate MAY only backfill ids、timestamps、metadata 或 structured facts
