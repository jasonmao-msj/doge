## ADDED Requirements

### Requirement: Discarding unstaged changes MUST restore from the index

For a tracked path, the unstaged-discard operation MUST restore the working-tree content from the current index entry. It MUST preserve staged content and MUST NOT restore the path directly from `HEAD`.

#### Scenario: Path has staged and unstaged changes
- **WHEN** a file contains staged content in the index plus newer unstaged edits in the working tree and the user discards only unstaged changes
- **THEN** the working tree MUST become byte-equivalent to the index entry
- **AND** the staged diff against `HEAD` MUST remain unchanged

#### Scenario: Desktop and daemon perform the same operation
- **WHEN** unstaged discard is invoked through desktop or daemon mode
- **THEN** both paths MUST call the same Git core semantics and return equivalent errors

#### Scenario: Restore fails
- **WHEN** Git cannot restore the working tree from the index
- **THEN** the operation MUST fail with repository/path context
- **AND** it MUST NOT report success or run a destructive fallback against `HEAD`
