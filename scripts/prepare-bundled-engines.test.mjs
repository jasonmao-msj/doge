import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  createOutputStage,
  resolveRequestedTarget,
  runtimeArchitecture,
  targetVariants,
  validateArchiveEntries,
} from "./prepare-bundled-engines.mjs";

test("creates the final stage beside the output for atomic cross-platform rename", async () => {
  const root = mkdtempSync(join(tmpdir(), "doge-bundled-output-test-"));
  try {
    const output = join(root, "resources", "bundled-engines", "current");
    const stage = await createOutputStage(output);
    assert.equal(dirname(stage), dirname(output));
    assert.match(basename(stage), /^\.current-stage-/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
