import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bridgeBuildFingerprint,
  filesMatch,
  isPreparedBridgeCurrent,
  writeFileIfChanged,
} from "./prepare-wechat-bridge.mjs";

test("compares bridge binaries by content instead of size alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "doge-wechat-bridge-match-test-"));
  try {
    const source = join(root, "source.exe");
    const destination = join(root, "destination.exe");
    writeFileSync(source, "bridge-a");
    writeFileSync(destination, "bridge-a");
    assert.equal(await filesMatch(source, destination), true);

    writeFileSync(destination, "bridge-b");
    assert.equal(await filesMatch(source, destination), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not rewrite an unchanged bridge manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "doge-wechat-bridge-manifest-test-"));
  try {
    const manifest = join(root, "manifest.json");
    writeFileSync(manifest, "current\n");
    assert.equal(await writeFileIfChanged(manifest, "current\n"), false);
    assert.equal(await writeFileIfChanged(manifest, "next\n"), true);
    assert.equal(readFileSync(manifest, "utf8"), "next\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("build fingerprint changes with target, compiler, or rustflags", () => {
  const base = bridgeBuildFingerprint("x86_64-pc-windows-msvc", {
    compilerIdentity: "rustc-test",
    env: {},
  });
  assert.equal(base, bridgeBuildFingerprint("x86_64-pc-windows-msvc", {
    compilerIdentity: "rustc-test",
    env: {},
  }));
  assert.notEqual(base, bridgeBuildFingerprint("aarch64-apple-darwin", {
    compilerIdentity: "rustc-test",
    env: {},
  }));
  assert.notEqual(base, bridgeBuildFingerprint("x86_64-pc-windows-msvc", {
    compilerIdentity: "rustc-next",
    env: {},
  }));
  assert.notEqual(base, bridgeBuildFingerprint("x86_64-pc-windows-msvc", {
    compilerIdentity: "rustc-test",
    env: { RUSTFLAGS: "-C target-cpu=native" },
  }));
});

test("reuses only a matching fingerprint manifest with an existing binary", () => {
  const root = mkdtempSync(join(tmpdir(), "doge-wechat-bridge-current-test-"));
  try {
    const executable = join(root, "x86_64", "wechat-bridge.exe");
    const manifest = {
      schemaVersion: 1,
      architectures: {
        x86_64: {
          target: "x86_64-pc-windows-msvc",
          executable: "x86_64/wechat-bridge.exe",
          provider: "@tencent-weixin/openclaw-weixin",
          providerVersion: "2.4.6",
          providerIntegrity: "integrity",
          buildFingerprint: "fingerprint",
        },
      },
    };
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    assert.equal(isPreparedBridgeCurrent(root, manifest), false);
    mkdirSync(join(root, "x86_64"), { recursive: true });
    writeFileSync(executable, "binary", { flag: "w" });
    assert.equal(isPreparedBridgeCurrent(root, manifest), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
