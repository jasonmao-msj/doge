## ADDED Requirements

### Requirement: Windows desktop runtime MUST avoid platform-default stack and console hazards

The Windows `doge` desktop binary MUST reserve an 8 MiB main-thread stack, heap-box selected deep async call chains, and launch background discovery commands without a visible console window. macOS and Linux behavior MUST remain unchanged.

#### Scenario: Windows binary receives the stack reserve
- **WHEN** the Windows desktop binary is linked
- **THEN** the linker configuration MUST target the canonical `doge` binary and reserve 8 MiB stack space
- **AND** no upstream binary name MAY be referenced

#### Scenario: Deep runtime acquisition does not inflate the caller stack
- **WHEN** Codex session spawn/ensure, engine detection, or runtime restart enters a known deep async chain
- **THEN** that future MUST be heap boxed at the selected boundary
- **AND** routing, provider identity, and error propagation MUST remain unchanged

#### Scenario: Windows discovery is visually silent
- **WHEN** the app runs PowerShell or `where` only to inspect icons/binaries
- **THEN** it MUST use the existing no-window command helper
- **AND** no transient console window SHOULD appear

### Requirement: Main-window F5 protection MUST be Windows-scoped and failure-safe

The Windows main WebView MUST ignore F5 reload through a renderer key guard plus a native accelerator/message guard. Guard installation failure MUST NOT block startup or unmount the application.

#### Scenario: F5 cannot reload the main window
- **WHEN** the main Windows WebView has focus and the user presses F5 without a product-owned binding
- **THEN** the event MUST be consumed without reloading application state

#### Scenario: Guard setup fails
- **WHEN** the native Windows guard cannot be attached
- **THEN** the failure MUST remain diagnostic-only
- **AND** the AppShell MUST still mount and the renderer guard MUST remain active

#### Scenario: Non-Windows platforms skip the native guard
- **WHEN** doge runs on macOS or Linux
- **THEN** no Windows message hook or Windows-only dependency path MUST execute

### Requirement: Process liveness helpers MUST compile and degrade conservatively per platform

Process liveness probing MUST use `kill(pid, 0)` only on Unix. Windows MUST use an explicit conservative branch rather than compiling or calling POSIX APIs.

#### Scenario: Unix liveness probe
- **WHEN** a positive PID is checked on Unix
- **THEN** the helper MUST use the existing signal-zero probe semantics

#### Scenario: Windows lacks equivalent proof
- **WHEN** the same helper is called on Windows without an authoritative process handle
- **THEN** it MUST return not-alive and delegate recovery to the scoped runtime owner
- **AND** it MUST NOT fabricate a live result

### Requirement: macOS OpenSSL fixup MUST use one canonical app-binary directory

The macOS packaging helper MUST derive the main and daemon binary paths from a defined `${app_path}/Contents/MacOS` owner before validating or rewriting dylib references. Optional OpenSSL references MUST tolerate an empty `otool` match under `set -euo pipefail`.

#### Scenario: Complete doge app bundle is fixed and signed
- **WHEN** `scripts/macos-fix-openssl.sh` receives an app containing `Contents/MacOS/doge` and optional `doge_daemon`
- **THEN** directory validation and binary discovery MUST use the same defined `macos_dir`
- **AND** the helper MUST reach reference verification and the selected signing path without an unbound-variable failure

#### Scenario: A binary does not link an optional OpenSSL library directly
- **WHEN** `otool -L` returns no `libssl` or `libcrypto` match for one binary
- **THEN** the empty match MUST be treated as no rewrite required
- **AND** `pipefail` MUST NOT terminate packaging
