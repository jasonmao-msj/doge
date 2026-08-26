## ADDED Requirements

### Requirement: Focused UI contracts MUST avoid heavyweight parent harnesses

Leaf-owned UI behavior tests MUST render the lowest component that owns the contract. A parent integration harness MAY remain only when the assertion depends on parent orchestration or cross-surface state. Test timeout inflation MUST NOT replace test-scope reduction when a leaf harness can express the same behavior.

#### Scenario: leaf disclosure behavior has a focused owner

- **WHEN** a test only verifies that a child `<details>` surface is collapsed, expands on click, and renders supplied explanation content
- **THEN** the test MUST render that child component directly with representative domain props
- **AND** MUST NOT mount an unrelated graph/application shell solely to reach the disclosure

#### Scenario: Windows batched load does not require timeout inflation

- **WHEN** the focused test runs inside the Windows batched suite under sustained runner load
- **THEN** it MUST complete under the default Vitest timeout
- **AND** the fix MUST NOT raise the global or per-test timeout to hide incidental parent initialization cost
