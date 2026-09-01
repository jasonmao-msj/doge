#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chmod, cp, mkdtemp, rename, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const SOURCE_MANIFEST = join(SCRIPT_DIR, "bundled-engines.manifest.json");
const CACHE_DIR = join(ROOT, ".cache", "bundled-engines");
const STAGING_DIR = join(ROOT, ".cache", "bundled-engines-staging");
const OUTPUT_DIR = join(ROOT, "src-tauri", "resources", "bundled-engines", "current");

const TARGET_ALIASES = new Map([
  ["mac-arm64", "aarch64-apple-darwin"],
  ["mac-x64", "x86_64-apple-darwin"],
  ["mac-universal", "universal-apple-darwin"],
  ["win-x64", "x86_64-pc-windows-msvc"],
]);

function hostTarget() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "x86_64-pc-windows-msvc";
  }
  if (process.platform === "linux") {
    return `${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu`;
  }
  throw new Error("Bundled Codex/Claude artifacts are supported only for macOS arm64/x64 and Windows x64.");
}

export function resolveRequestedTarget(env = process.env, argv = process.argv.slice(2)) {
  const raw = argv.find((value) => !value.startsWith("--"))
    ?? env.DOGE_BUNDLED_ENGINE_TARGET
    ?? env.TAURI_ENV_TARGET_TRIPLE
    ?? env.TARGET;
  if (!raw) return hostTarget();
  return TARGET_ALIASES.get(raw) ?? raw;
}

export function targetVariants(target) {
  if (target.endsWith("-unknown-linux-gnu")) return [];
  if (target === "universal-apple-darwin") {
    return ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  }
  if (["aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc"].includes(target)) {
    return [target];
  }
  throw new Error(`Unsupported bundled-engine target: ${target}`);
}

export function runtimeArchitecture(target) {
  if (target.startsWith("aarch64-")) return "aarch64";
  if (target.startsWith("x86_64-")) return "x86_64";
  throw new Error(`Unsupported target architecture: ${target}`);
}

export async function createOutputStage(outputDir, stagingParent = dirname(outputDir)) {
  mkdirSync(stagingParent, { recursive: true });
  return mkdtemp(join(stagingParent, ".current-stage-"));
}

export function validateArchiveEntries(entries) {
  for (const rawEntry of entries) {
    const entry = rawEntry.trim().replaceAll("\\", "/");
    if (!entry) continue;
    if (entry.startsWith("/") || /^[A-Za-z]:\//.test(entry)) {
      throw new Error(`Archive contains an absolute path: ${entry}`);
    }
    if (entry.split("/").includes("..")) {
      throw new Error(`Archive contains a parent traversal: ${entry}`);
    }
  }
}

function validateRelativePath(value, label) {
  const normalized = String(value ?? "").trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`${label} must be a relative path without parent traversal: ${value}`);
  }
  return normalized;
}

export function resolveVariantRoot(extracted, variant) {
  const root = validateRelativePath(variant.root ?? ".", "Artifact root");
  const resolvedRoot = resolve(extracted, root);
  if (relative(extracted, resolvedRoot).split(sep).includes("..") || !existsSync(resolvedRoot)) {
    throw new Error(`Expected artifact root is missing: ${root}`);
  }
  return resolvedRoot;
}

export function validateChecksum(actual, expected, label = "artifact") {
  const normalizedExpected = String(expected ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedExpected) || actual.toLowerCase() !== normalizedExpected) {
    throw new Error(`Checksum mismatch for ${label}: expected ${expected}, received ${actual}`);
  }
}

export function validateExtractedVariantFiles(artifactRoot, variant) {
  const executableRelative = validateRelativePath(variant.executable, "Executable");
  const files = [
    [executableRelative, `${variant.engineId ?? "artifact"} executable`],
    ...(variant.requiredFiles ?? []).map((file) => [
      validateRelativePath(file, "Required file"),
      `${variant.engineId ?? "artifact"} required file`,
    ]),
  ];
  for (const [relativePath, label] of files) {
    const resolvedPath = resolve(artifactRoot, relativePath);
    if (relative(artifactRoot, resolvedPath).split(sep).includes("..")) {
      throw new Error(`${label} escapes artifact root: ${relativePath}`);
    }
    let metadata;
    try {
      metadata = statSync(resolvedPath);
    } catch (error) {
      const code = error?.code === "EACCES" ? "permission denied" : "missing";
      throw new Error(`Expected ${label} is ${code}: ${relativePath}`);
    }
    if (metadata.isDirectory()) {
      throw new Error(`Expected ${label} is a directory: ${relativePath}`);
    }
  }
  return { executableRelative, executable: resolve(artifactRoot, executableRelative) };
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function runtimeVariantMetadata(version, target, variant, outputPath) {
  const executableRelative = validateRelativePath(variant.executable, "Executable");
  return {
    version,
    executable: `${runtimeArchitecture(target)}/${outputPath}/${executableRelative}`.replaceAll("\\", "/"),
    archiveSha256: variant.sha256,
    ...(variant.root ? { root: variant.root } : {}),
    ...(variant.requiredFiles ? { requiredFiles: variant.requiredFiles } : {}),
  };
}

export function buildRuntimeManifest(source, requestedTarget) {
  const runtime = { schemaVersion: 1, target: requestedTarget, architectures: {} };
  for (const target of targetVariants(requestedTarget)) {
    const arch = runtimeArchitecture(target);
    runtime.architectures[arch] = { target, engines: {}, runtimes: {} };
    for (const [engineId, engine] of Object.entries(source.engines)) {
      const variant = engine.variants?.[target];
      if (!variant) throw new Error(`Missing ${engineId} artifact for ${target}`);
      runtime.architectures[arch].engines[engineId] = runtimeVariantMetadata(
        engine.version,
        target,
        variant,
        engineId,
      );
    }
    for (const [runtimeId, runtimeDefinition] of Object.entries(source.runtimes ?? {})) {
      const variant = runtimeDefinition.variants?.[target];
      if (!variant) continue;
      runtime.architectures[arch].runtimes[runtimeId] = {
        ...runtimeVariantMetadata(
          runtimeDefinition.version,
          target,
          variant,
          `runtimes/${runtimeId}`,
        ),
        ...(runtimeDefinition.source ? { source: runtimeDefinition.source } : {}),
        ...(runtimeDefinition.license ? { license: runtimeDefinition.license } : {}),
      };
    }
  }
  return runtime;
}

function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function isPreparedOutputCurrent(outputDir, expectedRuntime) {
  let currentRuntime;
  try {
    currentRuntime = JSON.parse(readFileSync(join(outputDir, "manifest.json"), "utf8"));
  } catch {
    return false;
  }
  if (JSON.stringify(currentRuntime) !== JSON.stringify(expectedRuntime)) return false;

  for (const [arch, architecture] of Object.entries(expectedRuntime.architectures)) {
    const artifacts = [
      ...Object.entries(architecture.engines).map(([id, metadata]) => ({
        base: join(outputDir, arch, id),
        metadata,
      })),
      ...Object.entries(architecture.runtimes).map(([id, metadata]) => ({
        base: join(outputDir, arch, "runtimes", id),
        metadata,
      })),
    ];
    for (const { base, metadata } of artifacts) {
      const executable = resolve(outputDir, validateRelativePath(metadata.executable, "Executable"));
      if (!isRegularFile(executable)) return false;
      for (const requiredFile of metadata.requiredFiles ?? []) {
        const relativePath = validateRelativePath(requiredFile, "Required file");
        const resolvedPath = resolve(base, relativePath);
        if (relative(base, resolvedPath).split(sep).includes("..") || !isRegularFile(resolvedPath)) {
          return false;
        }
      }
    }
  }
  return true;
}

async function downloadToCache(engineId, target, variant) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const extension = variant.archive === "zip"
    ? "zip"
    : variant.archive === "7z"
      ? "7z.exe"
      : "tar.gz";
  const cachePath = join(CACHE_DIR, `${engineId}-${target}-${variant.sha256}.${extension}`);
  if (existsSync(cachePath) && await sha256(cachePath) === variant.sha256) return cachePath;
  rmSync(cachePath, { force: true });

  const response = await fetch(variant.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${engineId} for ${target}: HTTP ${response.status}`);
  }
  const temporary = `${cachePath}.partial-${process.pid}`;
  rmSync(temporary, { force: true });
  const file = await import("node:fs").then(({ createWriteStream }) => createWriteStream(temporary, { flags: "wx" }));
  try {
    await response.body.pipeTo(new WritableStream({
      write(chunk) {
        return new Promise((accept, reject) => file.write(Buffer.from(chunk), (error) => error ? reject(error) : accept()));
      },
      close() {
        return new Promise((accept, reject) => file.end((error) => error ? reject(error) : accept()));
      },
      abort(reason) {
        file.destroy();
        throw reason;
      },
    }));
    const actual = await sha256(temporary);
    validateChecksum(actual, variant.sha256, `${engineId}/${target}`);
    await rename(temporary, cachePath);
    return cachePath;
  } finally {
    rmSync(temporary, { force: true });
  }
}

function runTar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`tar ${args[0]} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function findSevenZip() {
  for (const candidate of ["7z", "7zz", "7za"]) {
    const result = spawnSync(candidate, ["--help"], { encoding: "utf8" });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error("7z/7zz is required to extract a PortableGit runtime artifact.");
}

function runSevenZip(args) {
  const executable = findSevenZip();
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${executable} ${args[0]} failed: ${result.error?.message || (result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

export function parseSevenZipEntries(output) {
  const entries = [];
  let archiveHeaderSeen = false;
  for (const line of output.split(/\r?\n/)) {
    if (line === "Type = 7z") {
      archiveHeaderSeen = true;
      continue;
    }
    if (archiveHeaderSeen && line.startsWith("Path = ")) {
      entries.push(line.slice("Path = ".length));
    }
  }
  return entries;
}

const RETRYABLE_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const COPY_FALLBACK_RENAME_CODES = new Set([
  ...RETRYABLE_RENAME_CODES,
  "EXDEV",
]);

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function renameWithRetry(source, destination, {
  renamePath = rename,
  sleep = wait,
  retries = 4,
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renamePath(source, destination);
      return;
    } catch (error) {
      if (!RETRYABLE_RENAME_CODES.has(error?.code) || attempt >= retries) {
        throw error;
      }
      await sleep(50 * (2 ** attempt));
    }
  }
}

function listSevenZipEntries(archivePath) {
  return parseSevenZipEntries(runSevenZip(["l", "-slt", archivePath]));
}

async function extractArchive(archivePath, destination) {
  const entries = runTar(["-tf", archivePath]).split(/\r?\n/);
  validateArchiveEntries(entries);
  mkdirSync(destination, { recursive: true });
  runTar(["-xf", archivePath, "-C", destination]);
}

async function extractVariantArchive(archivePath, variant, destination) {
  if (variant.archive === "7z") {
    validateArchiveEntries(listSevenZipEntries(archivePath));
    mkdirSync(destination, { recursive: true });
    runSevenZip(["x", "-y", archivePath, `-o${destination}`]);
    return;
  }
  await extractArchive(archivePath, destination);
}

async function prepareVariant(engineId, version, target, variant, stageRoot, outputPath = engineId) {
  const archivePath = await downloadToCache(engineId, target, variant);
  const extracted = await mkdtemp(join(tmpdir(), `doge-${engineId}-`));
  try {
    await extractVariantArchive(archivePath, variant, extracted);
    const artifactRoot = resolveVariantRoot(extracted, variant);
    const { executableRelative, executable } = validateExtractedVariantFiles(artifactRoot, {
      ...variant,
      engineId,
    });
    if ((await stat(executable)).isDirectory()) {
      throw new Error(`Expected ${engineId} executable is a directory: ${variant.executable}`);
    }
    if (process.platform !== "win32") await chmod(executable, 0o755);

    const arch = runtimeArchitecture(target);
    const destination = join(stageRoot, arch, outputPath);
    mkdirSync(dirname(destination), { recursive: true });
    await cp(artifactRoot, destination, { recursive: true, force: true });
    return runtimeVariantMetadata(version, target, { ...variant, executable: executableRelative }, outputPath);
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
}

export async function replaceOutputTree(outputDir, stageRoot, operations = {}) {
  const copyPath = operations.copyPath ?? cp;
  const removeTree = operations.removeTree
    ?? ((path) => rmSync(path, { recursive: true, force: true }));
  const renameOptions = {
    renamePath: operations.renamePath,
    sleep: operations.sleep,
    retries: operations.renameRetries,
  };
  const previousOutput = `${outputDir}.previous-${process.pid}`;
  removeTree(previousOutput);
  if (existsSync(outputDir)) {
    await renameWithRetry(outputDir, previousOutput, renameOptions);
  }
  try {
    try {
      await renameWithRetry(stageRoot, outputDir, renameOptions);
    } catch (error) {
      if (!COPY_FALLBACK_RENAME_CODES.has(error?.code)) throw error;
      await copyPath(stageRoot, outputDir, { recursive: true, force: true });
      removeTree(stageRoot);
    }
  } catch (error) {
    removeTree(outputDir);
    if (existsSync(previousOutput) && !existsSync(outputDir)) {
      await renameWithRetry(previousOutput, outputDir, renameOptions);
    }
    throw error;
  }
  removeTree(previousOutput);
}

async function main() {
  const source = JSON.parse(readFileSync(SOURCE_MANIFEST, "utf8"));
  if (source.schemaVersion !== 1 || !source.engines) throw new Error("Unsupported bundled engine source manifest.");
  const requestedTarget = resolveRequestedTarget();
  const variants = targetVariants(requestedTarget);
  const runtime = buildRuntimeManifest(source, requestedTarget);
  if (isPreparedOutputCurrent(OUTPUT_DIR, runtime)) {
    process.stdout.write(`Bundled engines already prepared for ${requestedTarget}: ${relative(ROOT, OUTPUT_DIR)}\n`);
    return;
  }
  const stageRoot = await createOutputStage(OUTPUT_DIR, STAGING_DIR);
  try {
    for (const target of variants) {
      for (const [engineId, engine] of Object.entries(source.engines)) {
        const variant = engine.variants?.[target];
        if (!variant) throw new Error(`Missing ${engineId} artifact for ${target}`);
        process.stdout.write(`Preparing ${engineId} ${engine.version} for ${target}...\n`);
        await prepareVariant(
          engineId,
          engine.version,
          target,
          variant,
          stageRoot,
        );
      }
      for (const [runtimeId, runtimeDefinition] of Object.entries(source.runtimes ?? {})) {
        const variant = runtimeDefinition.variants?.[target];
        if (!variant) continue;
        process.stdout.write(`Preparing runtime ${runtimeId} ${runtimeDefinition.version} for ${target}...\n`);
        await prepareVariant(
          runtimeId,
          runtimeDefinition.version,
          target,
          variant,
          stageRoot,
          `runtimes/${runtimeId}`,
        );
      }
    }
    writeFileSync(join(stageRoot, "manifest.json"), `${JSON.stringify(runtime, null, 2)}\n`);
    await replaceOutputTree(OUTPUT_DIR, stageRoot);
    process.stdout.write(`Bundled engines prepared for ${requestedTarget}: ${relative(ROOT, OUTPUT_DIR)}\n`);
  } catch (error) {
    rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
