## 1. Contract And Runtime Summary [P0]

- [x] 1.1 [Input: existing authority endpoints; Output: `subscription.read` canonical projection] Add the typed Gateway/Rust read path without calling the 365-day usage dashboard.
- [x] 1.2 [Depends: 1.1] [Input: active engine catalog + subscription summary; Output: mapped/unmapped subscription facts] Map only reliable Codex/Claude entitlements and preserve multiple subscription identities.
- [x] 1.3 [Depends: 1.1] [Input: unavailable authority/vault/session; Output: typed safe state] Cover unavailable, stale and malformed responses without fabricated quota values.

## 2. Account And Sidebar Experience [P0]

- [x] 2.1 [Input: `subscription.read` projection; Output: responsive subscription cards] Render plan, daily usage/limit and expiry for each subscription card.
- [x] 2.2 [Input: current Header commands; Output: focused account Header] Remove the redundant shield action while preserving password and low-frequency security surfaces.
- [x] 2.3 [Input: Sidebar layout callbacks; Output: lazy account shortcut] Add the bottom shortcut/popover and Settings account handoff without polling or a new top-level page.

## 3. Managed New-Session Default [P0]

- [x] 3.1 [Input: authenticated onboarding readiness; Output: eligible managed-engine facts] Propagate only successfully prepared active Codex/Claude entitlements into App Shell creation state.
- [x] 3.2 [Depends: 3.1] [Input: default target resolution + provider-scoped catalog; Output: managed new-session target] Bind `doge-token-matrix` for eligible new sessions and ensure selected models come from its catalog.
- [x] 3.3 [Depends: 3.2] [Input: explicit/local/existing cases; Output: preserved user intent] Verify Local Mode, existing thread bindings and explicit local/manual provider never receive an implicit managed override.

## 4. Verification And Spec Closure [P0]

- [x] 4.1 Run focused unit/component/Rust tests and the runtime contract/type/lint gates.
- [x] 4.2 [Depends: 3.1-3.3] Update the foundation calibration entry with code facts before closing this change.
