import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEV_INDEX_HTML = "<!doctype html><meta charset=\"utf-8\"><title>doge dev placeholder</title>\n";

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
}
