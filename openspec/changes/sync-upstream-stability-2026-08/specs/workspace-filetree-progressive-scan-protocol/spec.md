## ADDED Requirements

### Requirement: Network-drive compatibility MUST NOT weaken path containment

Windows mapped/network workspaces MAY use a fallback when OS final-path canonicalization is unavailable, but only after normalized relative-path containment and reparse/symlink safety can be proven. External absolute read/write/delete boundaries MUST remain fail closed until equivalent proof exists.

#### Scenario: Canonicalization fails without a containment proof
- **WHEN** the OS cannot canonicalize a workspace candidate and the implementation cannot prove it stays inside the workspace root
- **THEN** the operation MUST fail with a recoverable path error
- **AND** it MUST NOT use a lexical prefix check as equivalent security proof

#### Scenario: Dedicated network-drive proof is added later
- **WHEN** a future implementation supplies bounded Windows reparse/symlink validation and mapped-drive fixtures
- **THEN** read/list/write compatibility MAY be enabled only for the verified operation classes
