import { constants } from "node:fs";
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DEV_INDEX_HTML = "<!doctype html><meta charset=\"utf-8\"><title>doge dev placeholder</title>\n";
const BUNDLED_ENGINE_RELATIVE_PATH = path.join("src-tauri", "resources", "bundled-engines", "current");
const DEBUG_BUNDLED_ENGINE_RELATIVE_PATH = path.join(
  "src-tauri",
  "target",
  "debug",
  "bundled-engines",
  "current",
);

async function writeFileIfMissing(filePath, contents) {
  try {
    await writeFile(filePath, contents, { flag: "wx" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return;
    }
    throw error;
  }
}

export async function ensureTauriDevResourcePlaceholders(repoRoot) {
  const distDir = path.join(repoRoot, "dist");
  const assetsDir = path.join(distDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  await writeFileIfMissing(path.join(distDir, "index.html"), DEV_INDEX_HTML);
  await writeFileIfMissing(path.join(assetsDir, ".tauri-dev-placeholder"), "");
  await stageBundledEngineResources(repoRoot);
}

async function stageBundledEngineResources(repoRoot) {
  const source = path.join(repoRoot, BUNDLED_ENGINE_RELATIVE_PATH);
  const destination = path.join(repoRoot, DEBUG_BUNDLED_ENGINE_RELATIVE_PATH);
  const sourceManifest = path.join(source, "manifest.json");
  let manifest;
  try {
    const sourceStats = await lstat(source);
    if (!sourceStats.isDirectory()) throw new Error("source is not a directory");
    manifest = await readFile(sourceManifest, "utf8");
    validateRuntimeManifest(manifest);
  } catch (error) {
    throw new Error(`Tauri dev requires prepared bundled engines at ${source}: ${error.message}`);
  }

  if (await hasMatchingManifest(destination, manifest)) return;

  const destinationParent = path.dirname(destination);
  const staging = path.join(destinationParent, `.current-stage-${process.pid}-${Date.now()}`);
  await mkdir(destinationParent, { recursive: true });
  try {
    // Tauri copies configured resources into target/debug after this hook. A
    // symlink would make its source and destination identical and truncate the
    // bundled files during that copy, so debug staging must be a real tree.
    await cp(source, staging, { recursive: true, force: true, mode: constants.COPYFILE_FICLONE });
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw new Error(`failed to stage bundled engines for Tauri dev: ${error.message}`);
  }
}

function validateRuntimeManifest(manifest) {
  let parsed;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    throw new Error("manifest is not a supported bundled-engine runtime manifest");
  }
  if (parsed?.schemaVersion !== 1 || !parsed.architectures || typeof parsed.architectures !== "object") {
    throw new Error("manifest is not a supported bundled-engine runtime manifest");
  }
}

async function hasMatchingManifest(destination, expectedManifest) {
  try {
    const destinationStats = await lstat(destination);
    if (!destinationStats.isDirectory() || destinationStats.isSymbolicLink()) return false;
    return (await readFile(path.join(destination, "manifest.json"), "utf8")) === expectedManifest;
  } catch {
    return false;
  }
}
