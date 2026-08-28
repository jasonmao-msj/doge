## MODIFIED Requirements

### Requirement: CLI engine visibility SHALL preserve explicit user choices and provide a product-curated first-install default

「引擎管理」导航 MUST 将 CLI 分为「已启用」「未启用」「暂未开放」三组渲染。`supported: true` 且未被用户停用的 CLI MUST 归入「已启用」；`supported: true` 且已被用户停用的 CLI MUST 归入「未启用」；`supported: false` 的 CLI MUST 全部归入「暂未开放」。

当持久化 `disabledCliEngines` 字段不存在时，系统 MUST 将 `grok`、`kimi`、`opencode` 视为默认停用，同时让 `codex` 与 `claude` 保持启用。字段存在时（包括空数组），系统 MUST 保留其值，不得用新的默认值覆盖用户既有选择。

#### Scenario: first install uses product-curated engine defaults

- **WHEN** the application reads settings whose `disabledCliEngines` field is absent
- **THEN** Codex and Claude MUST appear in「已启用」
- **AND** Grok、Kimi、OpenCode MUST appear in「未启用」
- **AND** those engines MUST remain manually enableable from「引擎管理」

#### Scenario: stored choice remains authoritative

- **WHEN** settings contain any explicit `disabledCliEngines` value, including `[]`
- **THEN** the application MUST use that value unchanged
- **AND** it MUST NOT insert or remove engine ids during startup

#### Scenario: disabled engine lands in the disabled group

- **WHEN** user disables a supported CLI from its more-actions menu
- **THEN** that CLI MUST move from「已启用」to「未启用」
- **AND** the change MUST persist to `AppSettings.disabledCliEngines`
- **AND**「未启用」MUST auto-expand once so the user can see its destination

#### Scenario: disabled and unavailable groups are collapsed by default

- **WHEN** the vendor settings panel mounts with engines in「未启用」or「暂未开放」
- **THEN**「未启用」MUST default to collapsed
- **AND**「暂未开放」MUST default to collapsed

#### Scenario: disabled engine configuration stays reachable

- **WHEN** user selects an engine inside「未启用」
- **THEN** its configuration surface MUST remain reachable
- **AND** enabling it MUST return it to「已启用」without deleting its configuration
