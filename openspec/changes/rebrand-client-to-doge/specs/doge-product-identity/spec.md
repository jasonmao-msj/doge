## ADDED Requirements

### Requirement: doge MUST be the canonical shipping product identity

The repository MUST define one non-secret canonical doge brand manifest, and shipping frontend, Rust, Tauri, npm/Cargo metadata, native menu, binary, daemon, bundle identifier and build artifact identities MUST match it. Static manifests MAY duplicate values only when automated validation proves they equal the canonical manifest.

#### Scenario: Build metadata is inspected

- **WHEN** brand validation reads the canonical manifest and shipping manifests
- **THEN** product/display name MUST be `doge`
- **AND** production bundle identifier MUST be `io.github.jasonmao-msj.doge`
- **AND** package, binary, daemon and release artifact identities MUST use doge rather than a legacy product name

#### Scenario: Development application starts

- **WHEN** a developer launches the Tauri development application
- **THEN** the development identity MUST be distinguishable as `doge-dev`
- **AND** its bundle identifier MUST NOT collide with the production doge application

### Requirement: Normal user-facing surfaces MUST present doge only

WebView UI, native menus, window titles, About, lock screen, settings, error/feedback actions, installers, update UI, release notes and current product documentation MUST present doge as the product owner. They MUST NOT present an upstream repository, upstream product name or upstream-owned feedback/download endpoint as the doge product surface.

#### Scenario: User navigates primary product surfaces

- **WHEN** the user opens the home screen, settings, About, native menu, lock screen or an error report action
- **THEN** visible product copy and links MUST use doge
- **AND** no action MUST route the user to an upstream-owned issue, download or product page

#### Scenario: User installs a platform bundle

- **WHEN** the user inspects a macOS, Windows or Linux doge installer and installed application
- **THEN** file names, application label, icons and bundle metadata MUST identify doge
- **AND** legacy product artwork MUST NOT be used as the current doge icon or installer background

### Requirement: Brand narrative MUST distinguish vision from shipped capability

doge product copy MUST describe an anthropomorphic AI Shiba assistant for life and work while explicitly presenting the current release as developer-workflow-first. Current documentation MUST NOT claim unimplemented life-management integrations as shipped capabilities.

#### Scenario: Reader opens the product overview

- **WHEN** a reader opens current doge README or About copy
- **THEN** the brand story MUST describe the doge AI Shiba assistant
- **AND** the current capability statement MUST identify the existing engineering workbench focus
- **AND** calendar, household, payment or other unimplemented life services MUST NOT be listed as available

### Requirement: Visual identity MUST cover the platform asset matrix

doge MUST have a reviewed master mascot asset and platform-appropriate simplified variants. The repository MUST derive or replace every icon and installer asset consumed by Tauri, macOS, Windows, Linux and current product documentation.

#### Scenario: Platform icon inventory is validated

- **WHEN** the brand asset gate enumerates Tauri icon configuration and platform icon directories
- **THEN** every referenced raster/vector/icon file MUST exist
- **AND** each required size MUST derive from the approved doge identity
- **AND** 16px and 32px variants MUST remain visually recognizable in manual review

#### Scenario: README visual is refreshed

- **WHEN** current README displays an application icon, banner or screenshot
- **THEN** it MUST show doge artwork and doge UI
- **AND** it MUST NOT reuse a legacy-branded screenshot as a current product fact

#### Scenario: User opens Appearance settings

- **WHEN** a user opens the Appearance section after upgrading from a version that stored an alternate app icon preference
- **THEN** the UI MUST keep the alternate app icon selector hidden
- **AND** the installed application MUST continue to present the canonical doge icon
- **AND** legacy icon preference data MAY remain readable only for backward compatibility

### Requirement: Third-party engine identity MUST remain intact

The doge rebrand MUST NOT rename third-party engines, providers, protocols or compatibility fields merely because their identifier contains a generic or historical token. Any retained third-party or legacy field MUST be classified by the brand allowlist rather than silently rewritten.

#### Scenario: Brand replacement encounters a provider field

- **WHEN** a scan encounters Claude Code, Codex, Gemini, Grok, Kimi, OpenCode, cc-switch or a legacy provider schema field
- **THEN** the implementation MUST preserve the external contract when renaming would break compatibility
- **AND** the allowlist MUST record the compatibility reason
