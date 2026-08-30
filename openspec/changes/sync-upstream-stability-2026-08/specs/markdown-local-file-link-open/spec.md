## ADDED Requirements

### Requirement: Markdown local file links MUST normalize platform paths without changing ordinary links

The renderer MUST recognize safe local Markdown references for Windows drive paths, UNC paths, POSIX absolute paths, and workspace-relative paths while preserving HTTP(S), fragment, mail, and malformed references as non-local links.

#### Scenario: Windows drive path opens as a local resource
- **WHEN** Markdown contains a file reference such as `C:\\repo\\src\\main.ts:12` or its percent-encoded equivalent
- **THEN** the system MUST normalize the drive/path/line metadata and route it through the local file opener
- **AND** it MUST NOT interpret the drive letter as a URL scheme

#### Scenario: UNC path stays local and bounded
- **WHEN** Markdown contains a valid UNC reference
- **THEN** the system MUST preserve the UNC authority and normalized path for the local opener
- **AND** malformed or incomplete UNC input MUST remain ordinary visible text/link content

#### Scenario: Web links are unaffected
- **WHEN** Markdown contains an `https:`, `mailto:`, or fragment reference
- **THEN** the local file-link parser MUST NOT claim or rewrite that reference

### Requirement: Local file opening MUST remain inside the existing workspace/native ownership boundary

Parsed Markdown MUST NOT directly access the filesystem; it MUST call the existing application-owned file opening contract and preserve its workspace, external-path, and error semantics.

#### Scenario: Local resource is opened through the application owner
- **WHEN** a user activates a parsed local file link
- **THEN** the renderer MUST send the normalized path and optional location to the existing opener owner
- **AND** direct browser navigation or renderer filesystem access MUST NOT occur

#### Scenario: Rejected path remains recoverable
- **WHEN** the application owner rejects a path as unavailable or outside its allowed boundary
- **THEN** the conversation MUST remain usable and the existing recoverable error feedback MUST be shown
