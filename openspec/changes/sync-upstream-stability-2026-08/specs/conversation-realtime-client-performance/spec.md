## ADDED Requirements

### Requirement: Retained terminal output MUST remain bounded independently of dispatch cadence

The system MUST bound retained `commandExecution` output to 256 KiB-equivalent text units and retained `fileChange` output to 1 MiB-equivalent text units at reducer and history-normalization boundaries. The bounded representation MUST preserve a stable head, the most recent tail, and an explicit cumulative omitted-count marker.

#### Scenario: Long-running command streams many chunks
- **WHEN** command output grows beyond the command budget across repeated appends
- **THEN** reducer state MUST remain within the configured budget
- **AND** the head, recent tail, and cumulative omitted count MUST remain visible

#### Scenario: File change exceeds its larger budget
- **WHEN** a file-change tool emits a large diff below 1 MiB
- **THEN** the diff MUST remain intact
- **AND** only output above the file-change budget MAY be folded with the same explicit marker

#### Scenario: History or snapshot contains oversized output
- **WHEN** an oversized tool item enters presentation through history/snapshot normalization instead of live reducer append
- **THEN** the same bounded-output helper MUST apply
- **AND** the history path MUST NOT become an unbounded bypass

### Requirement: Output scheduling and output retention MUST remain separate controls

The existing tool-output tail gate MAY throttle dispatch cadence, while the retained-output budget controls state size. Disabling one rollback control MUST NOT silently change the other's ownership.

#### Scenario: Tail gate flushes a large buffered chunk
- **WHEN** the scheduling gate flushes a chunk larger than the retained command budget
- **THEN** the reducer MUST still apply the retained-output budget before publishing state
