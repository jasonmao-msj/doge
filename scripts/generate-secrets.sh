#!/bin/bash
# Safe local preflight for doge release credentials.
# This script never exports, encodes, writes, or prints secret material.

set -euo pipefail

required_variables=(
  APPLE_SIGNING_IDENTITY
  APPLE_TEAM_ID
  APPLE_API_ISSUER_ID
  APPLE_API_KEY_ID
  APPLE_CERTIFICATE_P12_PATH
  APPLE_API_PRIVATE_KEY_PATH
  TAURI_SIGNING_PRIVATE_KEY_PATH
)

missing=()
for variable in "${required_variables[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    missing+=("$variable")
  fi
done

if (( ${#missing[@]} > 0 )); then
  printf 'doge release credential preflight failed: missing local variables:\n'
  printf '  - %s\n' "${missing[@]}"
  printf '\nSet paths and identifiers in your local shell; never commit them or paste values into logs.\n'
  exit 1
fi

secret_paths=(
  "$APPLE_CERTIFICATE_P12_PATH"
  "$APPLE_API_PRIVATE_KEY_PATH"
  "$TAURI_SIGNING_PRIVATE_KEY_PATH"
)
for secret_path in "${secret_paths[@]}"; do
  if [[ ! -f "$secret_path" ]]; then
    printf 'doge release credential preflight failed: a configured secret file is missing.\n' >&2
    exit 1
  fi
done

if ! security find-identity -v -p codesigning 2>/dev/null \
  | grep -Fq -- "$APPLE_SIGNING_IDENTITY"; then
  printf 'doge release credential preflight failed: configured signing identity is unavailable.\n' >&2
  exit 1
fi

printf 'doge release credential preflight passed.\n'
printf 'Upload credentials with your approved secret-management workflow using stdin or file input.\n'
printf 'This repository does not generate, persist, or print credential values.\n'
