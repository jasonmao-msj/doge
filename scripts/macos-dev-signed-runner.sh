#!/usr/bin/env bash
set -euo pipefail

identity_name="${DOGE_DEV_CODESIGN_IDENTITY:-Doge Local Development}"
keychain_path="${DOGE_DEV_KEYCHAIN_PATH:-${HOME}/Library/Keychains/login.keychain-db}"
bundle_identifier="${DOGE_DEV_BUNDLE_IDENTIFIER:-io.github.jasonmao-msj.doge}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The Doge signed development runner is only available on macOS." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "The Doge signed development runner requires an executable path." >&2
  exit 1
fi

binary_path="$1"
shift

if [[ ! -x "${binary_path}" ]]; then
  echo "Doge development executable is unavailable: ${binary_path}" >&2
  exit 1
fi

identity_hash="$({
  security find-identity -v -p codesigning "${keychain_path}" 2>/dev/null \
    | awk -v identity="${identity_name}" 'index($0, "\"" identity "\"") && !found { print $2; found = 1 }'
} || true)"
if [[ -z "${identity_hash}" ]]; then
  echo "Missing Doge development signing identity. Run scripts/setup-macos-dev-signing.sh first." >&2
  exit 1
fi

codesign \
  --force \
  --sign "${identity_hash}" \
  --keychain "${keychain_path}" \
  --identifier "${bundle_identifier}" \
  "${binary_path}"
codesign --verify --strict "${binary_path}"

exec "${binary_path}" "$@"
