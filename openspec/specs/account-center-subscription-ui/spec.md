# account-center-subscription-ui Specification

## Purpose

定义 authenticated Account Center 的 subscription-first tabs、订阅卡片与账户身份操作布局。

## Requirements

### Requirement: Account Center SHALL Use A Subscription-First Two-Tab Information Architecture

Authenticated Account Center MUST expose exactly `subscription` and `usage` as its primary tabs. The subscription surface MUST directly render the account's subscribed engines and MUST NOT require a second “my engines” page or an “overview” indirection. Repeated account-title and profile-summary rows MUST NOT be rendered in the primary content area.

#### Scenario: authenticated user opens Account Center

- **WHEN** a Token Matrix session is authenticated
- **THEN** Account Center MUST render “订阅” and “额度” as the primary tabs
- **AND** the subscription tab MUST directly render the available subscribed engine cards
- **AND** it MUST NOT render a standalone “账号” content title, duplicated profile row, or “我的引擎” navigation action

#### Scenario: user has no active subscription

- **WHEN** the authenticated account has no active engine subscription
- **THEN** the subscription tab MUST render the existing subscription acquisition state in place
- **AND** it MUST NOT navigate the user through an empty intermediate engines page

### Requirement: Account Identity Editing And Password Command SHALL Remain Discoverable

The current display name MUST support inline editing with confirm and cancel controls. Password change MUST be exposed as a persistent Header icon command with an accessible name and hover/focus tooltip. Password form values MUST remain local/transient and the existing successful password-change sign-out behavior MUST remain intact.

#### Scenario: user edits display name

- **WHEN** the user activates the display name in the authenticated header
- **THEN** an inline editable control with confirm and cancel actions MUST appear
- **AND** confirming MUST call the existing profile update authority operation
- **AND** cancelling MUST restore the last authority-provided display name without persistence

#### Scenario: user changes password from Header

- **WHEN** the user focuses or hovers the password Header icon
- **THEN** a readable tooltip naming the password action MUST appear
- **WHEN** the user activates the command and successfully changes the password
- **THEN** password values MUST be cleared and the application MUST return to the sign-in state
