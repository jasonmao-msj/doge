# macos-development-account-vault Specification

## ADDED Requirements

### Requirement: macOS Debug SHALL Avoid Interactive Credential Authorization

macOS debug builds MUST persist Account refresh credentials and managed engine keys in a dedicated local development vault under the application data directory. The normal `npm run tauri:dev:hot` workflow MUST NOT read, write or fall back to macOS Keychain.

#### Scenario: An unattended E2E agent cold-starts the debug app

- **WHEN** Doge is built with `debug_assertions` on macOS and starts through `npm run tauri:dev:hot`
- **THEN** Account vault status/read/write/delete SHALL use the debug file vault
- **AND** startup SHALL NOT request Keychain authorization
- **AND** an existing valid debug refresh credential SHALL restore the account without human input
- **AND** the process SHALL use the canonical `doge` product name, bundle identifier and app-data directory rather than a separate `doge-dev` flavor

#### Scenario: The debug vault is initially empty

- **WHEN** a prior credential exists only in Keychain
- **THEN** the debug build SHALL behave as signed out instead of reading or migrating that Keychain entry
- **AND** after one successful login all subsequent debug restarts SHALL use the local development vault

### Requirement: Development Credentials SHALL Remain Owner-Only And Repo-External

The debug file vault MUST remain outside the repository and MUST fail closed for unsafe filesystem state.

#### Scenario: A debug secret is committed

- **WHEN** refresh or managed engine credential material is written
- **THEN** the containing directory SHALL have mode `0700`
- **AND** the regular credential file SHALL have mode `0600`
- **AND** the write SHALL use a same-directory create-new temporary file, sync and atomic rename under the storage lock
- **AND** logs/errors SHALL NOT contain the secret, serialized payload or private path

#### Scenario: A symlink or malformed vault file is encountered

- **WHEN** the vault directory/file is a symlink, is not a regular file, exceeds the bounded size, or contains an invalid schema/purpose
- **THEN** status/read/write SHALL fail closed with a stable safe error
- **AND** Doge SHALL NOT follow the link, overwrite the unsafe target or fall back to Keychain

### Requirement: Release Builds SHALL Continue To Use OS Credential Vaults

The development exception MUST be compile-time/platform-scoped and MUST NOT weaken distributed builds.

#### Scenario: Doge is not a macOS debug build

- **WHEN** the Account runtime selects its durable credential store
- **THEN** it SHALL construct the existing OS credential vault
- **AND** no renderer setting, environment toggle or persisted debug file SHALL redirect Release credential storage
