import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureTauriDevResourcePlaceholders } from "./tauri-dev-resources.mjs";

async function writeBundledEngineFixture(repoRoot, version = "0.147.0") {
  const root = path.join(repoRoot, "src-tauri", "resources", "bundled-engines", "current");
  await mkdir(path.join(root, "aarch64", "codex", "bin"), { recursive: true });
  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    architectures: { aarch64: { engines: { codex: { version } } } },
  })}\n`, "utf8");
  await writeFile(path.join(root, "aarch64", "codex", "bin", "codex"), "fixture binary", "utf8");
  return root;
}

test("creates Tauri dev resource placeholders for bundle globs", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "ccgui-tauri-dev-"));
  try {
    await writeBundledEngineFixture(repoRoot);
    await ensureTauriDevResourcePlaceholders(repoRoot);

    const indexHtml = await readFile(path.join(repoRoot, "dist", "index.html"), "utf8");
    const assetPlaceholder = await readFile(
      path.join(repoRoot, "dist", "assets", ".tauri-dev-placeholder"),
      "utf8",
    );

    assert.match(indexHtml, /doge dev placeholder/);
    assert.equal(assetPlaceholder, "");
    const stagedManifest = await readFile(
      path.join(repoRoot, "src-tauri", "target", "debug", "bundled-engines", "current", "manifest.json"),
      "utf8",
    );
    assert.equal(stagedManifest, `${JSON.stringify({
      schemaVersion: 1,
      architectures: { aarch64: { engines: { codex: { version: "0.147.0" } } } },
    })}\n`);
    assert.equal(
      (await lstat(path.join(repoRoot, "src-tauri", "target", "debug", "bundled-engines", "current"))).isSymbolicLink(),
      false,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("development commands inherit the canonical doge Tauri identity", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const baseConfig = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
  const hotRunner = await readFile("scripts/tauri-dev-hot.mjs", "utf8");
  const isolatedRunner = await readFile("scripts/tauri-dev-isolated.mjs", "utf8");

  assert.equal(
    packageJson.scripts["tauri:dev:hot"],
    "node scripts/tauri-dev-hot.mjs",
  );
  assert.match(
    packageJson.scripts["tauri:dev"],
    /doctor:strict.*tauri:dev:hot/,
  );
  assert.doesNotMatch(packageJson.scripts["tauri:dev:hot:signed:mac"], /tauri\.dev\.conf/);
  assert.doesNotMatch(isolatedRunner, /tauri\.dev\.conf/);
  assert.match(isolatedRunner, /assertNoConflictingPackagedDogeApp/);
  assert.match(isolatedRunner, /getTauriSpawnSpec/);
  assert.match(isolatedRunner, /prepareDevResources/);
  assert.doesNotMatch(isolatedRunner, /tauri\.cmd/);
  assert.match(hotRunner, /prepare-bundled-engines\.mjs/);
  assert.match(hotRunner, /prepare-wechat-bridge\.mjs/);
  assert.match(hotRunner, /getHotDevTauriArgs/);
  assert.match(isolatedRunner, /beforeDevCommand:\s*"node scripts\/tauri-dev-frontend\.mjs"/);
  await assert.rejects(readFile("src-tauri/tauri.dev.conf.json", "utf8"), {
    code: "ENOENT",
  });
  assert.equal(baseConfig.productName, "doge");
  assert.equal(baseConfig.identifier, "io.github.jasonmao-msj.doge");
  assert.equal(baseConfig.build?.devUrl, "http://localhost:1420");
});

test("does not overwrite existing frontend build artifacts", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "ccgui-tauri-dev-"));
  try {
    await writeBundledEngineFixture(repoRoot);
    const indexPath = path.join(repoRoot, "dist", "index.html");
    await ensureTauriDevResourcePlaceholders(repoRoot);
    await writeFile(indexPath, "<!doctype html><title>real build</title>\n", "utf8");

    await ensureTauriDevResourcePlaceholders(repoRoot);

    assert.equal(await readFile(indexPath, "utf8"), "<!doctype html><title>real build</title>\n");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("replaces stale debug bundled engine resources with the prepared source", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "ccgui-tauri-dev-"));
  try {
    await writeBundledEngineFixture(repoRoot, "0.147.0");
    const staleRoot = path.join(repoRoot, "src-tauri", "target", "debug", "bundled-engines", "current");
    await mkdir(staleRoot, { recursive: true });
    await writeFile(path.join(staleRoot, "manifest.json"), '{"schemaVersion":1,"architectures":{}}\n', "utf8");
    await writeFile(path.join(staleRoot, "obsolete"), "stale", "utf8");

    await ensureTauriDevResourcePlaceholders(repoRoot);

    assert.equal(
      await readFile(path.join(staleRoot, "manifest.json"), "utf8"),
      `${JSON.stringify({
        schemaVersion: 1,
        architectures: { aarch64: { engines: { codex: { version: "0.147.0" } } } },
      })}\n`,
    );
    await assert.rejects(lstat(path.join(staleRoot, "obsolete")));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("replaces a legacy debug resource symlink with an independent tree", {
  skip: process.platform === "win32",
}, async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "ccgui-tauri-dev-"));
  try {
    const source = await writeBundledEngineFixture(repoRoot);
    const destination = path.join(repoRoot, "src-tauri", "target", "debug", "bundled-engines", "current");
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(source, destination, "dir");

    await ensureTauriDevResourcePlaceholders(repoRoot);

    assert.equal((await lstat(destination)).isSymbolicLink(), false);
    assert.equal(
      await readFile(path.join(source, "manifest.json"), "utf8"),
      await readFile(path.join(destination, "manifest.json"), "utf8"),
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("fails before dev startup when bundled engines have not been prepared", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "ccgui-tauri-dev-"));
  try {
    await assert.rejects(
      ensureTauriDevResourcePlaceholders(repoRoot),
      /Tauri dev requires prepared bundled engines/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("fails before dev startup when the bundled-engine manifest is empty or invalid", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "ccgui-tauri-dev-"));
  try {
    const root = path.join(repoRoot, "src-tauri", "resources", "bundled-engines", "current");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "manifest.json"), "", "utf8");

    await assert.rejects(
      ensureTauriDevResourcePlaceholders(repoRoot),
      /manifest is not a supported bundled-engine runtime manifest/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
