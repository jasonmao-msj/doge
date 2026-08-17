#!/usr/bin/env bash
set -euo pipefail

app_path="${1:?app bundle path is required}"
mode="${2:-adhoc}"
identity="${3:-}"
bundled_engines_path="${app_path}/Contents/Resources/bundled-engines"

if [[ ! -d "${bundled_engines_path}" ]]; then
  echo "Bundled engine resources not present; nothing to sign."
  exit 0
fi
if [[ "${mode}" == "developer-id" && -z "${identity}" ]]; then
  echo "Developer ID identity is required for bundled engine signing." >&2
  exit 1
fi

while IFS= read -r -d '' candidate; do
  if ! file -b "${candidate}" | grep -q 'Mach-O'; then
    continue
  fi
  if [[ "${mode}" == "adhoc" ]]; then
    codesign --force --sign - "${candidate}"
  else
    codesign --force --options runtime --timestamp --sign "${identity}" "${candidate}"
  fi
done < <(find "${bundled_engines_path}" -type f -perm -111 -print0)
