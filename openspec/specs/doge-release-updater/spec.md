# doge-release-updater Specification

## Purpose
定义 doge desktop updater 的 canonical release feed、签名信任链、platform artifact 与 fail-closed release contract。

## Requirements

### Requirement: Shipping builds MUST use the doge signed update feed

Production desktop builds MUST enable Tauri updater artifacts and the updater plugin with the canonical doge release endpoint and the configured doge public key. The private signing key MUST remain outside the repository.

#### Scenario: valid shipping configuration

- **WHEN** a production Tauri configuration is inspected
- **THEN** updater artifacts are enabled for the base and Windows configurations
- **AND** the updater plugin is active
- **AND** its endpoint is `https://github.com/jasonmao-msj/doge/releases/latest/download/latest.json`
- **AND** its public key is the doge public key supplied for this change

#### Scenario: legacy trust source is rejected

- **WHEN** branding or release configuration is validated
- **THEN** the old `ccgui` repository, endpoint, or public key MUST NOT be used

### Requirement: Release publication MUST be fail-closed on trust-chain errors

The release workflow MUST validate signing secrets, updater activation, endpoint, public key, and required platform signatures before publishing `latest.json` or a GitHub release.

#### Scenario: missing signing secret

- **WHEN** a publishing workflow lacks `TAURI_SIGNING_PRIVATE_KEY_B64` or its password
- **THEN** preflight fails before release publication

#### Scenario: missing platform signature

- **WHEN** a Windows or macOS updater artifact has no matching `.sig`
- **THEN** the release job fails and does not publish an incomplete update manifest

### Requirement: Windows and macOS artifacts MUST match manifest platform entries

The generated `latest.json` MUST reference signed macOS `app.tar.gz` artifacts for both supported macOS architectures and a signed Windows NSIS installer for `windows-x86_64`, with URLs under the doge GitHub release.

#### Scenario: complete platform manifest

- **WHEN** the release job assembles `latest.json`
- **THEN** `darwin-aarch64`, `darwin-x86_64`, and `windows-x86_64` entries contain release URLs and non-empty signatures
- **AND** the manifest version matches the Tauri application version
