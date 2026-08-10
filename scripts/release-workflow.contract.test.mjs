import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function workflowJob(workflow, jobName) {
  const header = `  ${jobName}:\n`;
  const start = workflow.indexOf(header);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);
  const remainder = workflow.slice(start + header.length);
  const nextJob = remainder.search(/^  [a-zA-Z_][a-zA-Z0-9_]*:\n/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

test("release stays fail-closed until the independent doge updater trust chain exists", () => {
  const workflow = read(".github/workflows/release.yml");
  const preflight = workflowJob(workflow, "release_preflight");
  const release = workflowJob(workflow, "release");

  assert.match(preflight, /environment: release/);
  assert.match(preflight, /TAURI_SIGNING_PRIVATE_KEY_B64/);
  assert.match(preflight, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.match(preflight, /createUpdaterArtifacts/);
  assert.match(preflight, /Tauri updater plugin is disabled/);
  assert.match(
    preflight,
    /https:\/\/github\.com\/jasonmao-msj\/doge\/releases\/latest\/download\/latest\.json/,
  );

  for (const jobName of [
    "build_web_assets",
    "build_macos",
    "build_linux",
    "build_windows",
  ]) {
    assert.match(workflowJob(workflow, jobName), /needs: release_preflight/);
  }

  assert.match(release, /- release_preflight/);
  assert.match(release, /needs\.release_preflight\.result == 'success'/);
  assert.match(release, /name: Build latest\.json/);
  assert.match(release, /release-artifacts\/latest\.json/);
  assert.match(release, /Missing Linux updater signature/);
  assert.match(release, /Missing Windows updater signature/);
});

test("shipping updater config remains disabled without a doge public key", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  const windowsConfig = JSON.parse(read("src-tauri/tauri.windows.conf.json"));

  assert.equal(config.bundle?.createUpdaterArtifacts, false);
  assert.equal(windowsConfig.bundle?.createUpdaterArtifacts, false);
  assert.deepEqual(config.plugins?.updater, { endpoints: [], pubkey: "" });
  assert.notEqual(config.plugins?.updater?.active, true);
});

test("release/build surfaces use doge artifacts and never swallow build failures", () => {
  const workflow = read(".github/workflows/release.yml");
  const buildScript = read("scripts/build-platform.mjs");
  const dmgScript = read("scripts/create-dmg.sh");
  const shippingReleaseConfig = [workflow, buildScript, dmgScript].join("\n");

  assert.match(workflow, /release-artifacts\/doge_aarch64\.zip/);
  assert.match(workflow, /release-artifacts\/doge_x86_64\.zip/);
  assert.match(workflow, /name: doge-macos-/);
  assert.match(workflow, /name: doge-appimage-x86_64/);
  assert.match(workflow, /name: doge-windows-x64/);
  assert.match(workflow, /doge_aarch64\.app\.tar\.gz/);
  assert.match(workflow, /doge_x86_64\.app\.tar\.gz/);
  assert.match(workflow, /doge-web-assets_/);
  assert.match(buildScript, /doge_\$\{version\}_aarch64\.dmg/);
  assert.match(dmgScript, /\$STAGE_DIR\/doge\.app/);

  assert.doesNotMatch(
    shippingReleaseConfig,
    /ccgui|desktop-cc-gui|zhukunpenglinyutong|mossx|codemoss/i,
  );
  assert.doesNotMatch(buildScript, /error\.status\s*===\s*1/);
  assert.doesNotMatch(buildScript, /Developer ID Application: kunpeng/i);
});
