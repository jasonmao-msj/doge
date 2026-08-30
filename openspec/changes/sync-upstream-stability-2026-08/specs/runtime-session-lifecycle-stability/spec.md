## ADDED Requirements

### Requirement: Upstream liveness fixes MUST preserve doge terminal authority

The system MUST NOT clear a running turn solely because no first event or no text has appeared within a wall-clock interval. Any adopted liveness recovery MUST use scoped runtime/turn evidence and preserve exact owner identity.

#### Scenario: No first event at an arbitrary timeout
- **WHEN** a native turn is still processing but the frontend has received no first event by a timer threshold
- **THEN** the frontend MUST NOT fabricate a terminal or clear the active turn from timeout alone
- **AND** it MAY request scoped reconciliation or surface diagnostics

#### Scenario: Scoped runtime reports terminal
- **WHEN** reconciliation for the exact workspace, thread, turn, engine, and runtime owner reports terminal
- **THEN** the existing terminal settlement path MAY clear processing exactly once

### Requirement: Runtime cleanup and logical completion MUST remain separate

Process exit, pipe EOF, silence watchdog, and cleanup status MUST NOT override a typed completed/error/cancelled terminal already owned by the same attempt, and an exit after completed work MUST NOT trigger an automatic retry storm.

#### Scenario: Process exits after typed completion
- **WHEN** the runtime has already produced authoritative completion and the child process exits non-zero during cleanup
- **THEN** the attempt MUST remain completed
- **AND** Shared/provider retry MUST NOT start solely from that exit code

#### Scenario: Runtime exit has no scoped terminal proof
- **WHEN** a process exits without authoritative logical terminal evidence
- **THEN** the event MUST enter the existing scoped recovery/diagnostic path
- **AND** it MUST NOT borrow another turn or provider's terminal state
