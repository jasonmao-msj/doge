#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const RESOURCE_DIR = join(ROOT, "src-tauri", "resources", "wechat-bridge");
const PROVIDER_NAME = "@tencent-weixin/openclaw-weixin";
const PROVIDER_VERSION = "2.4.6";
const PROVIDER_INTEGRITY = "sha512-qw9k3PLTiMWGNjjsknHgcTManH1w4j+Ji1ArWIaYLKCq3aFRsVwcqnPi127bvOoVMJGW4dbyJ8NECEMgoO+iRw==";
const BUILD_INPUTS = [
  join(ROOT, "src-tauri", "src", "bin", "wechat_bridge.rs"),
  join(ROOT, "src-tauri", "Cargo.toml"),
  join(ROOT, "src-tauri", "Cargo.lock"),
  join(ROOT, "src-tauri", "build.rs"),
  join(ROOT, ".cargo", "config.toml"),
];

const TARGET_ALIASES = new Map([
  ["mac-arm64", "aarch64-apple-darwin"],
  ["mac-x64", "x86_64-apple-darwin"],
  ["mac-universal", "universal-apple-darwin"],
  ["win-x64", "x86_64-pc-windows-msvc"],
  ["linux-x64", "x86_64-unknown-linux-gnu"],
  ["linux-arm64", "aarch64-unknown-linux-gnu"],
]);

function hostTarget() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "win32") {
    if (process.arch !== "x64") throw new Error("WeChat bridge currently supports Windows x64 only.");
    return "x86_64-pc-windows-msvc";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  throw new Error("WeChat bridge supports macOS, Windows, and Linux only.");
}

export function resolveRequestedTarget(env = process.env, argv = process.argv.slice(2)) {
  const raw = argv.find((value) => !value.startsWith("--"))
    ?? env.DOGE_WECHAT_BRIDGE_TARGET
    ?? env.TAURI_ENV_TARGET_TRIPLE
    ?? env.TARGET;
  return TARGET_ALIASES.get(raw) ?? raw ?? hostTarget();
}

export function targetVariants(target) {
  if (target === "universal-apple-darwin") {
    return ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  }
  if (/^(aarch64|x86_64)-(apple-darwin|pc-windows-msvc|unknown-linux-gnu)$/.test(target)) {
    return [target];
  }
  throw new Error(`Unsupported WeChat bridge target: ${target}`);
}

export function runtimeArchitecture(target) {
  if (target.startsWith("aarch64-")) return "aarch64";
  if (target.startsWith("x86_64-")) return "x86_64";
  throw new Error(`Unsupported WeChat bridge architecture: ${target}`);
}

function executableName(target) {
  return target.endsWith("-pc-windows-msvc") ? "wechat-bridge.exe" : "wechat-bridge";
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function filesMatch(source, destination) {
  if (!existsSync(destination)) return false;
  try {
    const [sourceStat, destinationStat] = await Promise.all([
      stat(source),
      stat(destination),
    ]);
    if (!sourceStat.isFile() || !destinationStat.isFile() || sourceStat.size !== destinationStat.size) {
      return false;
    }
    const [sourceHash, destinationHash] = await Promise.all([
      sha256(source),
      sha256(destination),
    ]);
    return sourceHash === destinationHash;
  } catch {
    return false;
  }
}

export async function writeFileIfChanged(path, content) {
  try {
    if (await readFile(path, "utf8") === content) return false;
  } catch {
    // Missing or unreadable output is replaced below.
  }
  await writeFile(path, content, "utf8");
  return true;
}

function rustcIdentity() {
  const result = spawnSync("rustc", ["--version", "--verbose"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Unable to determine Rust compiler identity: ${result.stderr?.trim() || "rustc failed"}`);
  }
  return result.stdout.trim();
}

export function bridgeBuildFingerprint(target, {
  compilerIdentity = rustcIdentity(),
  env = process.env,
} = {}) {
  const hash = createHash("sha256");
  hash.update(`target\0${target}\0compiler\0${compilerIdentity}\0`);
  hash.update(`rustflags\0${env.RUSTFLAGS ?? ""}\0encoded\0${env.CARGO_ENCODED_RUSTFLAGS ?? ""}\0`);
  for (const path of BUILD_INPUTS) {
    hash.update(`path\0${path}\0`);
    hash.update(existsSync(path) ? readFileSync(path) : Buffer.from("<missing>"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function expectedArchitecture(target) {
  const arch = runtimeArchitecture(target);
  return [arch, {
    target,
    executable: `${arch}/${executableName(target)}`,
    provider: PROVIDER_NAME,
    providerVersion: PROVIDER_VERSION,
    providerIntegrity: PROVIDER_INTEGRITY,
    buildFingerprint: bridgeBuildFingerprint(target),
  }];
}

export function isPreparedBridgeCurrent(resourceDir, expectedManifest) {
  let currentManifest;
  try {
    currentManifest = JSON.parse(readFileSync(join(resourceDir, "manifest.json"), "utf8"));
  } catch {
    return false;
  }
  if (JSON.stringify(currentManifest) !== JSON.stringify(expectedManifest)) return false;
  return Object.values(expectedManifest.architectures).every((entry) => {
    const executable = resolve(resourceDir, entry.executable);
    return executable.startsWith(`${resolve(resourceDir)}${process.platform === "win32" ? "\\" : "/"}`)
      && isRegularFile(executable);
  });
}

function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function buildTarget(target) {
  const args = [
    "build",
    "--manifest-path",
    join(ROOT, "src-tauri", "Cargo.toml"),
    "--bin",
    "wechat-bridge",
    "--release",
    "--target",
    target,
  ];
  console.log(`Building WeChat bridge for ${target}...`);
  execFileSync(process.platform === "win32" ? "cargo.exe" : "cargo", args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });

  const executable = executableName(target);
  const source = join(ROOT, "src-tauri", "target", target, "release", executable);
  if (!existsSync(source)) {
    throw new Error(`WeChat bridge build completed without ${source}`);
  }
  const arch = runtimeArchitecture(target);
  const destination = join(RESOURCE_DIR, arch, executable);
  return { arch, target, source, destination };
}

async function main() {
  const requestedTarget = resolveRequestedTarget();
  const targets = targetVariants(requestedTarget);
  const architectures = Object.fromEntries(targets.map(expectedArchitecture));
  const manifest = { schemaVersion: 1, architectures };
  if (isPreparedBridgeCurrent(RESOURCE_DIR, manifest)) {
    console.log(`WeChat bridge already prepared for ${requestedTarget}.`);
    return;
  }

  const builds = targets.map(buildTarget);
  for (const build of builds) {
    await mkdir(dirname(build.destination), { recursive: true });
    if (!(await filesMatch(build.source, build.destination))) {
      copyFileSync(build.source, build.destination);
    }
    if (process.platform !== "win32") await chmod(build.destination, 0o755);
  }

  await writeFileIfChanged(
    join(RESOURCE_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`WeChat bridge prepared for ${requestedTarget}.`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`WeChat bridge preparation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
