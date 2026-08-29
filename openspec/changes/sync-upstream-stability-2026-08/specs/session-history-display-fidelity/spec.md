## ADDED Requirements

### Requirement: Upstream history-window fixes MUST NOT introduce a second history owner

Any future adoption of bounded/windowed history MUST preserve realtime-visible prefix/items and merge by stable semantic identity. Until the entire paging owner contract is adopted, isolated window helpers MUST NOT replace doge's current history source.

#### Scenario: Windowed hydrate overlaps realtime content
- **WHEN** a bounded history response overlaps items already visible from realtime
- **THEN** the merge MUST preserve complete visible content and add only authoritative missing history
- **AND** a shorter bounded snapshot MUST NOT overwrite a longer realtime/final item

#### Scenario: Paging architecture is not active
- **WHEN** doge has not adopted the corresponding canonical paging/window owner
- **THEN** an upstream leaf merge helper MUST NOT silently become the primary history source
