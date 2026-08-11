# Rebrand client to doge

## Source of truth

- OpenSpec change: `openspec/changes/rebrand-client-to-doge/`
- Apply request: `/opsx:apply rebrand-client-to-doge`
- Implementation branch: `chore/rebrand-client-to-doge`

## Objective

Turn the fork into an independently branded desktop client named `doge`: an anthropomorphic AI Shiba life-and-work assistant whose first release honestly focuses on developer workflows.

## Required outcomes

1. Ordinary users only see doge across the App, native chrome, installers, updates, current docs, feedback, and download links.
2. Shipping runtime no longer calls or trusts upstream-owned analytics, updater, web-assets, or managed-provider services.
3. Canonical identity is enforced across frontend, Rust, Tauri, npm/Cargo metadata, release workflows, and assets.
4. New persistent data uses the doge namespace; legacy `.ccgui`, `.mossx`, `.codemoss`, bundle data, browser keys, and serialized markers remain readable through copy-forward or dual-read compatibility.
5. Distribution uses `jasonmao-msj/doge` GitHub Releases and Tauri signatures, with no application server requirement.
6. All ten shipped locales and current documentation carry the doge story and tagline: `把复杂的事，叼回来做好。`
7. Developer-only upstream sync remains available through the read-only Git remote and governance docs, while legal/history attribution remains truthful.

## Constraints

- Preserve the MIT license and immutable historical records.
- Do not delete or overwrite legacy user data during migration.
- Do not commit updater private keys or fabricate release/manual-smoke evidence.
- Keep unrelated refactors out of scope.
- Treat `openspec/changes/rebrand-client-to-doge/tasks.md` as the detailed dependency and verification checklist.

## Acceptance

- The OpenSpec focused checks, brand/service scans, frontend gates, Rust gates, macOS dev smoke, and macOS ARM64 build are run and recorded.
- Tasks requiring external credentials, GitHub Secrets, signed releases, or unavailable Windows/Linux machines remain explicitly unchecked until genuinely verified.
- `openspec validate rebrand-client-to-doge --strict --no-interactive` passes.
