#!/usr/bin/env bash
set -euo pipefail

identity_name="${DOGE_DEV_CODESIGN_IDENTITY:-Doge Local Development}"
keychain_path="${DOGE_DEV_KEYCHAIN_PATH:-${HOME}/Library/Keychains/login.keychain-db}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Doge local development signing is only available on macOS." >&2
  exit 1
fi

for command_name in openssl security codesign; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command_name}" >&2
    exit 1
  fi
done

find_identity_hash() {
  security find-identity -v -p codesigning "${keychain_path}" 2>/dev/null \
    | awk -v identity="${identity_name}" 'index($0, "\"" identity "\"") && !found { print $2; found = 1 }'
}

if [[ -n "$(find_identity_hash)" ]]; then
  echo "Doge development signing identity is ready: ${identity_name}"
  exit 0
fi

umask 077
temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/doge-dev-signing.XXXXXX")"
cleanup() {
  rm -rf -- "${temporary_directory}"
}
trap cleanup EXIT

private_key_path="${temporary_directory}/identity-key.pem"
certificate_path="${temporary_directory}/identity-cert.pem"
pkcs12_path="${temporary_directory}/identity.p12"
pkcs12_password="$(openssl rand -hex 24)"

openssl req \
  -new \
  -newkey rsa:2048 \
  -nodes \
  -x509 \
  -days 3650 \
  -subj "/CN=${identity_name}/O=Doge Development" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=codeSigning" \
  -keyout "${private_key_path}" \
  -out "${certificate_path}" \
  >/dev/null 2>&1

openssl pkcs12 \
  -export \
  -inkey "${private_key_path}" \
  -in "${certificate_path}" \
  -name "${identity_name}" \
  -passout "pass:${pkcs12_password}" \
  -out "${pkcs12_path}"

security import "${pkcs12_path}" \
  -k "${keychain_path}" \
  -P "${pkcs12_password}" \
  -T /usr/bin/codesign \
  >/dev/null
security add-trusted-cert \
  -r trustRoot \
  -p codeSign \
  -k "${keychain_path}" \
  "${certificate_path}" \
  >/dev/null

if [[ -z "$(find_identity_hash)" ]]; then
  echo "Doge development signing identity could not be activated." >&2
  exit 1
fi

echo "Created Doge development signing identity: ${identity_name}"
echo "On the first Keychain prompt, choose Always Allow. Later hot rebuilds reuse this identity."
