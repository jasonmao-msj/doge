# WeChat Bridge Channel Cross-Platform Outbound File Link Delta

## ADDED Requirements

### Requirement: Outbound document links MUST preserve native platform path identity

The WeChat outbound adapter MUST normalize slash-prefixed Windows drive targets such as `/D:/workspace/report.pptx` with the same semantics as `D:/workspace/report.pptx` before canonical path validation on Windows. On non-Windows platforms, it MUST preserve native absolute path semantics and MUST NOT apply the Windows drive rewrite. Generated Markdown documents (`.md`) MUST be classified as generic files with `text/markdown` MIME and sent through the existing CDN-backed `file_item` pipeline. These additions MUST NOT bypass the existing allowed-root, regular-file, non-empty, extension, or size gates.

#### Scenario: Codex returns a slash-prefixed Windows document link

- **WHEN** a selected engine reply contains a Markdown link to `/D:/workspace/report.pptx` and that file is valid under the current workspace
- **THEN** the adapter MUST resolve the drive-absolute Windows path and create a `kind=file` outbound artifact
- **AND** the successful local link MUST be removed from the WeChat text reply
- **AND** a Markdown list marker left empty by that removal MUST NOT be sent as an empty bullet
- **AND** the bridge MUST send the document as a CDN-backed `file_item`

#### Scenario: Codex returns a generated Markdown document

- **WHEN** a selected engine reply links a valid `.md` file under the current workspace
- **THEN** the adapter MUST create a `kind=file` artifact with `mimeType=text/markdown`
- **AND** the bridge MUST send the Markdown document as a downloadable `file_item` instead of forwarding an inaccessible local link

#### Scenario: Codex returns a native absolute path on macOS or Linux

- **WHEN** a selected engine reply contains a Markdown link to a valid native absolute path under the current workspace
- **THEN** the adapter MUST preserve that absolute path and create the matching outbound artifact
- **AND** a drive-like Unix path such as `/D:/workspace/report.pptx` MUST NOT be rewritten to a workspace-relative path
