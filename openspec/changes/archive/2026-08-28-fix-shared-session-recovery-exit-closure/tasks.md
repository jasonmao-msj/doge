## 1. Wave 0–1 Classification & Contracts

- [x] 1.1 Audit begin/prepare/dispatch failure paths; ensure pure target-unavailable does not dispatch `ackAmbiguous`
- [x] 1.2 Keep ambiguous Tx1/RPC failures in recovery; add tests for both branches
- [x] 1.3 Surface `target-unavailable` reason and keep picker unlocked (UI copy)

## 2. Wave 2 Backend Exit Ladder

- [x] 2.1 Add `shared_session_v2_abandon_unresolved_attempt` (durable cancel, idempotent, ambiguous fail-closed)
- [x] 2.2 Keep rebuild refusal while `owns_attempt`; ensure interrupt then rebuild works; structured error prefixes
- [x] 2.3 Register command; Rust tests: rebuild settle single unresolved, abandon durable
- [x] 2.4 Clear binding recovery-required when no unresolved remain after abandon

## 3. Wave 2 Frontend Exit Ladder

- [x] 3.1 Wire interrupt + abandon RPC in `sharedSessions.ts`
- [x] 3.2 Recovery UI: Probe / Stop / Stop并重建 / 放弃本轮 + confirm dialog + busy guard
- [x] 3.3 Stop-and-rebuild strategy B; map recovery-active errors to i18n
- [x] 3.4 Feature flag `sharedRecoveryExitV2` default on
- [x] 3.5 FE tests for stop-rebuild, abandon, rebuild-held

## 4. Wave 3 Observability & i18n

- [x] 4.1 sharedSend keys (zh/en + all locale parity files)
- [x] 4.2 Disposition-specific recovery hints; technical detail optional
- [x] 4.3 Locale parity test green

## 5. Wave 4 P1 Fuse/Gateway Explain

- [x] 5.1 Fuse disabled title/reason when canFuse false (no active turn / recovery / capability)
- [x] 5.2 Map fuse failure network/daemon errors to actionable toast copy
- [x] 5.3 Minimal test for disabled reason title

## 6. Verification

- [x] 6.1 Focused vitest: SharedSendStatusBar + sendSharedSessionTurnV2 + locale parity + MessageQueue
- [x] 6.2 cargo test abandon + rebuild settle
- [x] 6.3 Batch code reviews (boundaries/compat/accuracy) after each wave; final holistic review
- [x] 6.4 Do NOT git commit (user review gate)
