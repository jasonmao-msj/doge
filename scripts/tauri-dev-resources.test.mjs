import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureTauriDevResourcePlaceholders } from "./tauri-dev-resources.mjs";

test("creates Tauri dev resource placeholders for bundle globs", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "ccgui-tauri-dev-"));
  try {
    await ensureTauriDevResourcePlaceholders(repoRoot);

    const indexHtml = await readFile(path.join(repoRoot, "dist", "index.html"), "utf8");
    const assetPlaceholder = await readFile(
      path.join(repoRoot, "dist", "assets", ".tauri-dev-placeholder"),
      "utf8",
    );

    assert.match(indexHtml, /doge dev placeholder/);
    assert.equal(assetPlaceholder, "");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("does not overwrite existing frontend build artifacts", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "ccgui-tauri-dev-"));
  try {
    const indexPath = path.join(repoRoot, "dist", "index.html");
    await ensureTauriDevResourcePlaceholders(repoRoot);
    await writeFile(indexPath, "<!doctype html><title>real build</title>\n", "utf8");

    await ensureTauriDevResourcePlaceholders(repoRoot);

    assert.equal(await readFile(indexPath, "utf8"), "<!doctype html><title>real build</title>\n");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
