## ADDED Requirements

### Requirement: doge updates MUST use the doge GitHub release feed

The production updater MUST fetch update metadata only from the `jasonmao-msj/doge` GitHub Releases feed over HTTPS. No doge update, download or web-assets path MAY resolve to an upstream repository.

#### Scenario: Installed doge checks for an update

- **WHEN** the Tauri updater performs a background or interactive update check
- **THEN** its endpoint MUST be `https://github.com/jasonmao-msj/doge/releases/latest/download/latest.json`
- **AND** update behavior MUST retain the existing background/interactive fallback semantics

#### Scenario: Release configuration is scanned

- **WHEN** automated release tests inspect Tauri config, workflow and build scripts
- **THEN** every doge-owned release URL MUST target `jasonmao-msj/doge`
- **AND** no upstream release URL MUST remain in a shipping path

### Requirement: doge MUST use an independent updater trust chain

doge update artifacts MUST be signed with a doge-owned Tauri updater private key, and installed doge clients MUST embed only the matching doge public key. The upstream updater public/private key pair MUST NOT authorize a doge update.

#### Scenario: Release job creates update metadata

- **WHEN** a release job builds update artifacts
- **THEN** each update artifact MUST have the signature required by Tauri
- **AND** `latest.json` MUST reference the doge artifact and signature for each published platform

#### Scenario: Signing secret is unavailable

- **WHEN** the doge updater private key or required password secret is missing
- **THEN** the release workflow MUST fail closed
- **AND** it MUST NOT publish unsigned or partially signed `latest.json`

#### Scenario: Client receives invalid metadata or artifact

- **WHEN** signature verification fails
- **THEN** doge MUST reject the update
- **AND** it MUST retain the currently installed version

### Requirement: GitHub Actions MUST produce a coherent doge platform artifact set

The release workflow MUST build doge-named artifacts for configured macOS, Windows and Linux targets, upload their updater signatures when supported, and generate a parseable `latest.json` whose platform URLs match the uploaded files.

#### Scenario: Version tag triggers release

- **WHEN** an authorized doge version tag runs the release workflow
- **THEN** artifact names MUST use doge identity and the tagged version
- **AND** configured platform entries in `latest.json` MUST resolve to files in the same GitHub Release

#### Scenario: Artifact matrix is incomplete

- **WHEN** a required build, rename, signature or metadata step fails
- **THEN** the workflow MUST NOT advertise the missing platform as available
- **AND** release readiness MUST remain failed until the matrix is coherent

#### Scenario: Maintainer requests an internal Windows test installer

- **WHEN** an authorized maintainer manually dispatches `windows_artifact_only=true`
- **THEN** a Windows runner MAY build and upload a doge-named unsigned NSIS installer plus SHA-256 as a short-lived Actions artifact
- **AND** the job MUST use read-only repository permission and MUST NOT access release secrets or the release environment
- **AND** it MUST NOT create a GitHub Release, updater signature or `latest.json`
- **AND** the resulting installer MUST remain explicitly classified as internal/unsigned rather than release-ready

### Requirement: Core doge operation MUST not require an application server

Application startup, local workspace use and update discovery MUST not depend on a doge-owned application server. GitHub Releases MAY serve static installers and update metadata; configured third-party AI providers retain their own service boundaries.

#### Scenario: No doge cloud backend exists

- **WHEN** the user launches doge without any doge-owned server
- **THEN** local application surfaces MUST start
- **AND** users MUST still be able to configure supported local CLIs or third-party AI providers

#### Scenario: GitHub update feed is temporarily unavailable

- **WHEN** a background update request fails because GitHub is unreachable
- **THEN** doge MUST continue normal local operation
- **AND** the background failure MUST remain non-blocking under the updater fallback contract

### Requirement: Release signing secrets MUST remain outside repository artifacts

Updater private keys, signing passwords, Apple/Windows signing secrets and provider secrets MUST NOT appear in source, build logs, `latest.json`, installers or diagnostics.

#### Scenario: Repository and release logs are scanned

- **WHEN** secret scanning inspects committed files and release output
- **THEN** only public updater material MAY be present
- **AND** private key/password content MUST be absent
