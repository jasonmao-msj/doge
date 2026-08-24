import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("macOS signed hot development uses a local identity and stable app identifier", () => {
  const packageJson = JSON.parse(read("package.json"));
  const setup = read("scripts/setup-macos-dev-signing.sh");
  const cargoWrapper = read("scripts/macos-dev-signed-cargo.sh");
  const runner = read("scripts/macos-dev-signed-runner.sh");

  assert.match(
    packageJson.scripts["tauri:dev:hot:signed:mac"],
    /setup-macos-dev-signing\.sh.*tauri-dev-hot\.mjs --runner.*macos-dev-signed-cargo\.sh/,
  );
  assert.match(setup, /extendedKeyUsage=codeSigning/);
  assert.match(setup, /security import/);
  assert.match(setup, /-T \/usr\/bin\/codesign/);
  assert.match(setup, /security add-trusted-cert/);
  assert.match(setup, /-p codeSign/);
  assert.match(setup, /openssl rand -hex 24/);
  assert.doesNotMatch(setup, /cat .*identity-(?:key|cert)/);
  assert.doesNotMatch(setup, /echo .*pkcs12_password/);

  assert.match(cargoWrapper, /rustc -vV/);
  assert.match(cargoWrapper, /CARGO_TARGET_/);
  assert.match(cargoWrapper, /macos-dev-signed-runner\.sh/);
  assert.match(cargoWrapper, /exec cargo "\$@"/);
  assert.doesNotMatch(cargoWrapper, /awk[^\n]*exit/);

  assert.match(runner, /io\.github\.jasonmao-msj\.doge/);
  assert.doesNotMatch(runner, /io\.github\.jasonmao-msj\.doge\.dev/);
  assert.match(runner, /security find-identity -v -p codesigning/);
  assert.match(runner, /codesign[\s\S]*--identifier/);
  assert.match(runner, /codesign --verify --strict/);
  assert.match(runner, /exec "\$\{binary_path\}" "\$@"/);
});
