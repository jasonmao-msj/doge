import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveRequestedTarget,
  runtimeArchitecture,
  targetVariants,
  validateArchiveEntries,
} from "./prepare-bundled-engines.mjs";

test("normalizes build-script aliases and explicit targets", () => {
  assert.equal(resolveRequestedTarget({}, ["mac-arm64"]), "aarch64-apple-darwin");
  assert.equal(resolveRequestedTarget({ DOGE_BUNDLED_ENGINE_TARGET: "win-x64" }, []), "x86_64-pc-windows-msvc");
});

test("expands universal macOS without changing single targets", () => {
  assert.deepEqual(targetVariants("universal-apple-darwin"), [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
  ]);
  assert.deepEqual(targetVariants("x86_64-pc-windows-msvc"), ["x86_64-pc-windows-msvc"]);
  assert.equal(runtimeArchitecture("aarch64-apple-darwin"), "aarch64");
});

test("rejects absolute and parent-traversal archive entries", () => {
  assert.throws(() => validateArchiveEntries(["../../escape"]), /parent traversal/);
  assert.throws(() => validateArchiveEntries(["C:\\escape.exe"]), /absolute path/);
  assert.doesNotThrow(() => validateArchiveEntries(["bin/codex", "codex-resources/zsh/rc"]));
});
