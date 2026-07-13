## ADDED Requirements

### Requirement: Programmatic bottom-follow MUST converge without anchor state feedback

当 `Messages` 通过 bottom-follow 将 active conversation viewport 保持在 true bottom 时，系统 MUST 使用不依赖 virtualized row 瞬时 geometry 的稳定 active message anchor，并且 MUST NOT 因 programmatic scroll、content resize 与 anchor state render 互相反馈而形成 React update loop。该稳定策略 MUST 保留现有 message anchor rail、scroll control 与 timeline 的可见行为。

#### Scenario: Repeated bottom-follow resize keeps the latest anchor stable

- **WHEN** streaming 或迟到的 virtual row measurement 重复改变 timeline 高度，且 viewport 仍处于 bottom-follow 的 near-bottom 区域
- **THEN** active message anchor MUST 稳定指向 latest user message anchor
- **AND** repeated programmatic scroll events MUST NOT 持续提交新的 anchor React state
- **AND** viewport MUST 继续保持在 true bottom

#### Scenario: User scroll-away retains viewport anchor tracking

- **WHEN** 用户主动向上滚动并离开 near-bottom 区域
- **THEN** bottom-follow MUST 按现有语义解除
- **AND** active message anchor MUST 继续根据当前 viewport 中的 message position 更新
- **AND** anchor rail 的外观、可见性与点击跳转行为 MUST 保持不变
