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
- [x] 3.4 [Depends: 3.2-3.3] [Input: create-session transient target lifecycle; Output: fresh managed default per new conversation] Clear an explicit local/manual creation target after leaving Home while preserving the created session's durable binding.
- [x] 3.5 [Depends: 3.1-3.3] [Input: same-engine Native local -> Token Matrix selection; Output: credential-ready managed transition] Reuse the Account Gate prepare transaction before Provider Continuation, including stale renderer `prepared` state.
- [x] 3.6 [Depends: 3.1-3.3] [Input: active entitlement + selected Home engine is unprepared; Output: automatic engine-scoped preparation] Request Account Gate once instead of silently projecting the local/disk default.
- [x] 3.7 [Depends: 3.2-3.6] [Input: Home picker + per-engine active entitlements; Output: managed channel default for every subscribed engine submenu] Project `doge-token-matrix` for inactive Codex/Claude submenus without changing existing-session bindings.

## 4. Verification And Spec Closure [P0]

- [x] 4.1 Run focused unit/component/Rust tests and the runtime contract/type/lint gates.
- [x] 4.2 [Depends: 3.1-3.3] Update the foundation calibration entry with code facts before closing this change.
- [x] 4.3 [Depends: 3.4] Run the focused create-session lifecycle regression, typecheck, lint and strict OpenSpec validation.
- [x] 4.4 [Depends: 3.5] Run the same-engine managed credential revalidation regression and verify no continuation request is emitted before preparation.
- [x] 4.5 [Depends: 3.6] Run the focused Home unprepared-entitlement regression, typecheck, lint and strict OpenSpec validation.
- [x] 4.6 [Depends: 3.7] Run the focused ModelSelect per-engine managed-default regression plus affected Composer checks.
