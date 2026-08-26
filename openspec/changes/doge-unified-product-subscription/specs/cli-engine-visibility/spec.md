## MODIFIED Requirements

### Requirement: composer 引擎选择器 MUST 隐藏已停用引擎

legacy `disabledCliEngines` 只允许隐藏非产品 CLI。authenticated product mode 下 Codex、Claude、Kimi 是强制可见的 managed engines；Rust settings owner 与 renderer boundary MUST 从 effective blacklist 中移除 `codex`、`claude`、`kimi`，任何 UI consumer 都不得重新应用旧值隐藏三者。

#### Scenario: 非产品停用引擎不出现在下拉

- **WHEN** legacy settings 已停用 Grok 或 OpenCode
- **AND** 打开仍消费 legacy visibility policy 的 engine selector
- **THEN** 下拉列表 MUST NOT 包含该非产品 engine

#### Scenario: 旧用户曾停用 product engine

- **WHEN** persisted `disabledCliEngines` 包含 `claude`、`codex` 或 `kimi`
- **THEN** settings read/update/restore normalization MUST 移除这些 product ids
- **AND** Composer、Sidebar、Home 与 Git picker 读取的 effective visibility MUST 保持三者可见

#### Scenario: 当前选中非产品引擎兜底显示

- **WHEN** 当前 legacy conversation 使用的非产品 engine 后来被停用
- **THEN** engine selector MUST 仍显示该当前值
- **AND** 该会话 MUST 继续正常工作

## REMOVED Requirements

### Requirement: 设置页 CLI 导航 MUST 按用户意愿分组展示

~~Settings 将 CLI 分为已启用、未启用、暂未开放三组，并提供启停菜单。~~ — shipping product 已由 authenticated `productPrepare` 固定管理 Codex/Claude/Kimi，用户不再承担 CLI visibility/provider configuration；Engine Management 整体隐藏。

## ADDED Requirements

### Requirement: Shipping UI MUST hide Engine Management

main product UI MUST NOT 暴露 Engine Management 的 Settings navigation、model-menu footer 或 legacy deep link。底层 provider/config implementation MAY 保留用于内部维护，但不得成为用户可达 surface。

#### Scenario: 用户打开 Settings

- **WHEN** authenticated 用户打开 Settings
- **THEN** sidebar MUST NOT 渲染“引擎管理”入口
- **AND** page MUST 默认或继续展示其他可用 section

#### Scenario: 用户打开 model menu

- **WHEN** authenticated 用户打开 Composer model menu
- **THEN** menu MUST NOT 渲染“引擎管理”footer action

#### Scenario: 旧 deep link 请求 hidden section

- **WHEN** legacy caller 请求 `providers`、`vendors` 或历史上转发到 provider surface 的 `permissions` Settings section
- **THEN** Settings MUST 回退 `basic`
- **AND** VendorSettingsPanel MUST NOT mount
