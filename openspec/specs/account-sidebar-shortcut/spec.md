# account-sidebar-shortcut Specification

## Purpose

定义 Sidebar 中按需访问账户订阅摘要的 compact shortcut，并约束其加载时机、失败降级和进入 Settings account 的导航边界。

## Requirements

### Requirement: Sidebar SHALL Provide An On-Demand Account Shortcut

The primary Sidebar MUST expose a compact account shortcut in its bottom navigation area. Activating it MUST reveal a compact account/subscription summary and provide a direct handoff to Settings account; it MUST NOT add another primary page, permanent explanatory text, or background summary polling.

#### Scenario: user opens account shortcut

- **WHEN** a user activates the Sidebar account shortcut
- **THEN** Doge MUST request the lightweight subscription summary only after that interaction
- **AND** the compact surface MUST show safe identity and available subscription/remaining quota facts
- **AND** activating the summary MUST open the existing Settings account page

#### Scenario: summary cannot be loaded

- **WHEN** the one-shot summary request fails or is unavailable
- **THEN** the shortcut MUST remain usable to open Settings account
- **AND** it MUST display the established non-sensitive unavailable state without retry polling
