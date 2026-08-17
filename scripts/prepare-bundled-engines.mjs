#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chmod, cp, mkdtemp, rename, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const SOURCE_MANIFEST = join(SCRIPT_DIR, "bundled-engines.manifest.json");
const CACHE_DIR = join(ROOT, ".cache", "bundled-engines");
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

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadToCache(engineId, target, variant) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const extension = variant.archive === "zip" ? "zip" : "tar.gz";
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
    if (actual !== variant.sha256) {
      throw new Error(`Checksum mismatch for ${engineId}/${target}: expected ${variant.sha256}, received ${actual}`);
    }
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

async function extractArchive(archivePath, destination) {
  const entries = runTar(["-tf", archivePath]).split(/\r?\n/);
  validateArchiveEntries(entries);
  mkdirSync(destination, { recursive: true });
  runTar(["-xf", archivePath, "-C", destination]);
}

async function prepareVariant(engineId, version, target, variant, stageRoot) {
  const archivePath = await downloadToCache(engineId, target, variant);
  const extracted = await mkdtemp(join(tmpdir(), `doge-${engineId}-`));
  try {
    await extractArchive(archivePath, extracted);
    const executable = resolve(extracted, variant.executable);
    if (relative(extracted, executable).split(sep).includes("..") || !existsSync(executable)) {
      throw new Error(`Expected ${engineId} executable is missing: ${variant.executable}`);
    }
    if ((await stat(executable)).isDirectory()) {
      throw new Error(`Expected ${engineId} executable is a directory: ${variant.executable}`);
    }
    if (process.platform !== "win32") await chmod(executable, 0o755);

    const arch = runtimeArchitecture(target);
    const destination = join(stageRoot, arch, engineId);
    mkdirSync(dirname(destination), { recursive: true });
    await cp(extracted, destination, { recursive: true, force: true });
    return {
      version,
      executable: `${arch}/${engineId}/${variant.executable}`.replaceAll("\\", "/"),
      archiveSha256: variant.sha256,
    };
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
}

async function main() {
  const source = JSON.parse(readFileSync(SOURCE_MANIFEST, "utf8"));
  if (source.schemaVersion !== 1 || !source.engines) throw new Error("Unsupported bundled engine source manifest.");
  const requestedTarget = resolveRequestedTarget();
  const variants = targetVariants(requestedTarget);
  const stageRoot = await mkdtemp(join(tmpdir(), "doge-bundled-engines-"));
  const runtime = { schemaVersion: 1, target: requestedTarget, architectures: {} };
  try {
    for (const target of variants) {
      const arch = runtimeArchitecture(target);
      runtime.architectures[arch] = { target, engines: {} };
      for (const [engineId, engine] of Object.entries(source.engines)) {
        const variant = engine.variants?.[target];
        if (!variant) throw new Error(`Missing ${engineId} artifact for ${target}`);
        process.stdout.write(`Preparing ${engineId} ${engine.version} for ${target}...\n`);
        runtime.architectures[arch].engines[engineId] = await prepareVariant(
          engineId,
          engine.version,
          target,
          variant,
          stageRoot,
        );
      }
    }
    writeFileSync(join(stageRoot, "manifest.json"), `${JSON.stringify(runtime, null, 2)}\n`);
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
    mkdirSync(dirname(OUTPUT_DIR), { recursive: true });
    await rename(stageRoot, OUTPUT_DIR);
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
