## ADDED Requirements

### Requirement: Windows main-window titlebar close requires confirmation every time

On Windows desktop, the custom main-window titlebar close control (X) MUST ask the user for confirmation on every click before destroying or closing the main window. Cancel and confirm-dialog failure MUST leave the window open. This behavior MUST be implemented in an isolated helper consumed only by the Windows titlebar close path so that macOS hide-on-close and non-Windows chrome remain unaffected.

#### Scenario: User confirms close from the Windows titlebar X

- **WHEN** the renderer is showing Windows desktop window controls
- **AND** the user activates the titlebar close (X) control
- **THEN** the client MUST present a **custom in-app confirmation dialog** (not the OS / `plugin-dialog` system prompt) before calling the window close API
- **AND WHEN** the user accepts the confirmation
- **THEN** the client MUST invoke the main window close API

#### Scenario: User cancels close from the Windows titlebar X

- **WHEN** the user activates the Windows titlebar close (X) control
- **AND** the user dismisses or cancels the confirmation dialog
- **THEN** the client MUST NOT call the main window close API
- **AND** the main window MUST remain open

#### Scenario: Repeated close clicks do not stack dialogs

- **WHEN** the custom close confirmation dialog is already open
- **OR** a confirmed close is still in flight
- **AND** the user activates the titlebar close (X) control again
- **THEN** the client MUST NOT open another confirmation dialog instance

#### Scenario: Close API failure is observable and leaves the window open

- **WHEN** the user accepts the confirmation dialog
- **AND** the window close API throws
- **THEN** the client MUST treat the result as a failed close (not a silent success)
- **AND** the client MUST log a warning for diagnostics
- **AND** the confirmation UI MUST become interactive again so the user can cancel or retry

#### Scenario: Non-Windows chrome is not wired to this confirm path

- **WHEN** the client runs on macOS or Linux desktop chrome
- **THEN** the Windows titlebar close confirmation helper MUST NOT be required for their native or platform window-close UX
- **AND** macOS close-to-hide behavior MUST remain independent of this requirement
