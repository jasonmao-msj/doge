# Kimi bundled cross-platform launch runtime

## ADDED Requirements

### Requirement: Kimi Windows Runtime MUST Be Usable Without User Git Bash Installation

Windows bundled Kimi runtime MUST carry and validate a compatible portable Git/Bash runtime so that a fresh supported Windows installation does not require a separately installed Git Bash, Node, or npm to execute Kimi CLI shell and Git tools.

#### Scenario: Fresh Windows installation has no Git Bash

- **WHEN** the user starts the bundled Kimi engine on supported Windows
- **AND** no system Git Bash, Node, or npm is installed
- **THEN** Kimi MUST resolve the bundled portable Git/Bash runtime
- **AND** version, ordinary prompt, shell tool, and Git tool probes MUST be executable
- **AND** the application MUST NOT modify the user’s global `PATH`

#### Scenario: Bundled Windows shell runtime is incomplete

- **WHEN** the bundled shell executable, required DLL, Git executable, or required support file is missing or invalid
- **THEN** Kimi readiness MUST be reported as blocked with a structured diagnostic
- **AND** the application MUST NOT start a turn that can only partially initialize
- **AND** the diagnostic MUST identify a repair/update action without exposing secrets

### Requirement: Kimi Launch Environment MUST Be Platform-Scoped And Consistent

Kimi send, version probe, toolchain inspection, and doctor MUST use the same resolved launch context for the selected platform and binary source. Launch environment changes MUST be process-scoped.

#### Scenario: Windows bundled Kimi launches with managed shell

- **WHEN** a bundled Kimi turn starts on Windows
- **THEN** the child process MUST receive the verified portable Git directories through its process-level `PATH`
- **AND** the launch MUST preserve the selected `KIMI_CODE_HOME`
- **AND** the command MUST use argv/path APIs rather than raw shell-string concatenation

#### Scenario: macOS bundled Kimi launches with system shell

- **WHEN** a bundled Kimi turn starts on supported macOS
- **THEN** the child process MUST use the verified system shell capability
- **AND** the macOS bundle MUST NOT require or contain the Windows portable Git runtime
- **AND** the application MUST NOT rewrite shell profile files

#### Scenario: Version probe and send share launch context

- **WHEN** `kimi --version` succeeds but the required shell probe fails
- **THEN** engine status MUST remain unavailable or blocked
- **AND** send MUST NOT use a different implicit PATH or shell resolution to claim readiness

### Requirement: Bundled Kimi Shell Artifacts MUST Be Integrity And Platform Verified

Bundled Kimi shell artifacts MUST be target-specific, checksum-verified, path-safe, and staged atomically before they become available to the application.

#### Scenario: Windows artifact is prepared

- **WHEN** the Windows bundled runtime is prepared
- **THEN** the Kimi executable and portable Git archive MUST pass SHA256 verification
- **AND** required files MUST be checked within the expected resource root
- **AND** a failed preparation MUST NOT leave a partial success tree

#### Scenario: macOS artifact is prepared

- **WHEN** a macOS bundled runtime is prepared
- **THEN** only the target macOS Kimi artifact and macOS resources MUST be staged
- **AND** Windows-only portable Git files MUST NOT be downloaded or packaged
