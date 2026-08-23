#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The Doge signed Cargo wrapper is only available on macOS." >&2
  exit 1
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
signed_runner="${script_directory}/macos-dev-signed-runner.sh"
host_triple="$(rustc -vV | awk '/^host: / && !found { print $2; found = 1 }')"

if [[ -z "${host_triple}" ]]; then
  echo "Unable to determine the Rust host triple for Doge development signing." >&2
  exit 1
fi

runner_environment_name="CARGO_TARGET_$(printf '%s' "${host_triple}" | tr '[:lower:]-' '[:upper:]_')_RUNNER"
export "${runner_environment_name}=${signed_runner}"

exec cargo "$@"
