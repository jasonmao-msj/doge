# account-authority-login-contract Specification

## ADDED Requirements

### Requirement: Password login converges to a complete durable desktop session

Doge MUST accept password login success only when token2api returns a complete response compatible with the advertised authority guarantees, and MUST keep Local Mode available on every failure path.

#### Scenario: Correct credentials produce a durable session

- **WHEN** the user submits correct credentials and authority negotiation succeeds
- **THEN** token2api returns a typed access/refresh token pair and user identity
- **AND** Doge commits the refresh secret to the OS vault and session metadata locally before presenting authenticated state

#### Scenario: Credentials are rejected

- **WHEN** token2api returns stable reason `INVALID_CREDENTIALS`
- **THEN** Doge presents the credentials-rejected action
- **AND** MUST NOT report a protocol failure

#### Scenario: Successful envelope violates the login payload contract

- **WHEN** an HTTP-success response is missing or invalidates a required durable-session invariant
- **THEN** Doge fails closed and keeps Local Mode usable
- **AND** records only a secret-safe stage diagnostic
- **AND** MUST NOT silently accept an access-only session

### Requirement: Login protocol failures are actionable and secret-safe

The Account UI MUST present an actionable localized message while retaining the stable diagnostic code for support, without exposing credentials or tokens.

#### Scenario: Protocol drift reaches the UI

- **WHEN** a protocol mismatch occurs during authority negotiation, credential exchange, session projection, or local commit
- **THEN** the UI identifies a retry/support action in Chinese
- **AND** diagnostic detail identifies the stage but excludes raw response bodies and secrets
