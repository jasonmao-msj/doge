import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rename } from "node:fs/promises";
import {
  buildRuntimeManifest,
  createOutputStage,
  isPreparedOutputCurrent,
  resolveRequestedTarget,
  runtimeArchitecture,
  targetVariants,
  resolveVariantRoot,
  replaceOutputTree,
  validateChecksum,
  validateExtractedVariantFiles,
  validateArchiveEntries,
  parseSevenZipEntries,
} from "./prepare-bundled-engines.mjs";

test("creates the final stage outside watched resources for atomic cross-platform rename", async () => {
  const root = mkdtempSync(join(tmpdir(), "doge-bundled-output-test-"));
  try {
    const output = join(root, "resources", "bundled-engines", "current");
    const staging = join(root, ".cache", "bundled-engines-staging");
    const stage = await createOutputStage(output, staging);
    assert.equal(dirname(stage), staging);
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

test("parses archive entries after the 7z SFX header", () => {
  const output = [
    "Listing archive: C:\\cache\\PortableGit.7z.exe",
    "--",
    "Path = C:\\cache\\PortableGit.7z.exe",
    "Type = 7z",
    "Physical Size = 123",
    "",
    "Path = bin",
    "Type = Directory",
    "",
    "Path = bin/bash.exe",
    "Type = 7z",
    "",
    "Path = usr/bin/bash.exe",
    "Type = File",
  ].join("\n");

  assert.deepEqual(parseSevenZipEntries(output), ["bin", "bin/bash.exe", "usr/bin/bash.exe"]);
});

test("resolves and strips a PortableGit archive root", () => {
  const root = mkdtempSync(join(tmpdir(), "doge-portable-git-root-test-"));
  try {
    const archiveRoot = join(root, "PortableGit");
    mkdirSync(archiveRoot);
    assert.equal(resolveVariantRoot(root, { root: "PortableGit" }), archiveRoot);
    assert.throws(() => resolveVariantRoot(root, { root: "../escape" }), /relative path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects checksum mismatches before an artifact is accepted", () => {
  assert.throws(
    () => validateChecksum("0".repeat(64), "1".repeat(64), "kimi-windows-shell/win-x64"),
    /Checksum mismatch for kimi-windows-shell\/win-x64/,
  );
  assert.throws(() => validateChecksum("0".repeat(64), "not-a-sha256"), /Checksum mismatch/);
  assert.doesNotThrow(() => validateChecksum("a".repeat(64), "A".repeat(64)));
});

test("rejects missing or directory required files", () => {
  const root = mkdtempSync(join(tmpdir(), "doge-required-files-test-"));
  try {
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin", "bash.exe"), "fake");
    assert.throws(
      () => validateExtractedVariantFiles(root, {
        executable: "bin/bash.exe",
        requiredFiles: ["usr/bin/msys-2.0.dll"],
      }),
      /is missing: usr\/bin\/msys-2\.0\.dll/,
    );
    mkdirSync(join(root, "etc"));
    assert.throws(
      () => validateExtractedVariantFiles(root, {
        executable: "bin/bash.exe",
        requiredFiles: ["etc"],
      }),
      /is a directory: etc/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replaces a stale output tree only after a complete stage exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "doge-output-replace-test-"));
  try {
    const output = join(root, "current");
    const stage = join(root, "stage");
    mkdirSync(output, { recursive: true });
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(output, "old.txt"), "old");
    writeFileSync(join(stage, "new.txt"), "new");
    await replaceOutputTree(output, stage);
    assert.equal(readFileSync(join(output, "new.txt"), "utf8"), "new");
    assert.equal(existsSync(join(output, "old.txt")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reuses a matching prepared output only while all declared files exist", () => {
  const root = mkdtempSync(join(tmpdir(), "doge-output-current-test-"));
  try {
    const source = {
      engines: {
        codex: {
          version: "1.2.3",
          variants: {
            "x86_64-pc-windows-msvc": {
              executable: "bin/codex.exe",
              requiredFiles: ["bin/helper.dll"],
              sha256: "a".repeat(64),
            },
          },
        },
      },
    };
    const runtime = buildRuntimeManifest(source, "x86_64-pc-windows-msvc");
    const artifact = join(root, "x86_64", "codex", "bin");
    mkdirSync(artifact, { recursive: true });
    writeFileSync(join(root, "manifest.json"), JSON.stringify(runtime));
    writeFileSync(join(artifact, "codex.exe"), "binary");
    writeFileSync(join(artifact, "helper.dll"), "library");

    assert.equal(isPreparedOutputCurrent(root, runtime), true);
    rmSync(join(artifact, "helper.dll"));
    assert.equal(isPreparedOutputCurrent(root, runtime), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("copies a complete stage when Windows refuses the final directory rename", async () => {
  const root = mkdtempSync(join(tmpdir(), "doge-output-copy-fallback-test-"));
  try {
    const output = join(root, "current");
    const stage = join(root, "staging", ".current-stage-test");
    mkdirSync(output, { recursive: true });
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(output, "old.txt"), "old");
    writeFileSync(join(stage, "new.txt"), "new");

    await replaceOutputTree(output, stage, {
      renamePath: async (source, destination) => {
        if (source === stage) {
          const error = new Error("simulated Windows directory lock");
          error.code = "EPERM";
          throw error;
        }
        await rename(source, destination);
      },
      renameRetries: 0,
    });

    assert.equal(readFileSync(join(output, "new.txt"), "utf8"), "new");
    assert.equal(existsSync(join(output, "old.txt")), false);
    assert.equal(existsSync(stage), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("declares the Windows shell runtime only for the Windows target", () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("./bundled-engines.manifest.json", import.meta.url)), "utf8"));
  assert.ok(manifest.runtimes["kimi-windows-shell"].variants["x86_64-pc-windows-msvc"]);
  assert.equal(manifest.runtimes["kimi-windows-shell"].variants["x86_64-apple-darwin"], undefined);
  assert.equal(manifest.runtimes["kimi-windows-shell"].variants["aarch64-apple-darwin"], undefined);
});
