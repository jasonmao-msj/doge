import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function resolveAsset(relativePath) {
  assert.equal(isAbsolute(relativePath), false, `${relativePath} must be repo-relative`);
  const absolutePath = resolve(ROOT, relativePath);
  assert.ok(
    absolutePath.startsWith(`${ROOT}${sep}`),
    `${relativePath} must stay inside the repository`,
  );
  assert.ok(statSync(absolutePath).isFile(), `${relativePath} must be a file`);
  return absolutePath;
}

function readPngHeader(relativePath) {
  const buffer = readFileSync(resolveAsset(relativePath));
  assert.ok(buffer.length >= 29, `${relativePath} must contain a PNG IHDR`);
  assert.deepEqual(
    buffer.subarray(0, PNG_SIGNATURE.length),
    PNG_SIGNATURE,
    `${relativePath} must use the PNG signature`,
  );
  assert.equal(buffer.readUInt32BE(8), 13, `${relativePath} IHDR length must be 13`);
  assert.equal(buffer.toString("ascii", 12, 16), "IHDR", `${relativePath} must start with IHDR`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

function assertPng(relativePath, expected) {
  const metadata = readPngHeader(relativePath);
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(metadata[field], value, `${relativePath} ${field} must be ${value}`);
  }
  return metadata;
}

test("canonical brand manifest points to production-quality RGBA sources", () => {
  const brand = JSON.parse(readFileSync(resolve(ROOT, "config/brand.json"), "utf8"));
  assert.equal(typeof brand.visual?.masterIcon, "string");
  assert.equal(typeof brand.visual?.appIconSource, "string");

  const master = assertPng(brand.visual.masterIcon, { bitDepth: 8, colorType: 6 });
  assert.equal(master.width, master.height, "master icon must be square");
  assert.ok(master.width >= 1024, "master icon must be at least 1024x1024");
  assertPng(brand.visual.appIconSource, {
    width: 1024,
    height: 1024,
    bitDepth: 8,
    colorType: 6,
  });
});

test("public and desktop icon matrix keeps canonical dimensions", () => {
  assertPng("public/app-icon.png", {
    width: 512,
    height: 512,
    bitDepth: 8,
    colorType: 6,
  });
  assertPng("src-tauri/icons/32x32.png", { width: 32, height: 32 });
  assertPng("src-tauri/icons/128x128.png", { width: 128, height: 128 });
  assertPng("src-tauri/icons/128x128@2x.png", { width: 256, height: 256 });
  resolveAsset("src-tauri/icons/icon.icns");
  resolveAsset("src-tauri/icons/icon.ico");
});

test("Windows Store icon matrix is complete", () => {
  const expectedSizes = new Map([
    ["Square30x30Logo.png", 30],
    ["Square44x44Logo.png", 44],
    ["Square71x71Logo.png", 71],
    ["Square89x89Logo.png", 89],
    ["Square107x107Logo.png", 107],
    ["Square142x142Logo.png", 142],
    ["Square150x150Logo.png", 150],
    ["Square284x284Logo.png", 284],
    ["Square310x310Logo.png", 310],
    ["StoreLogo.png", 50],
  ]);
  for (const [filename, size] of expectedSizes) {
    assertPng(`src-tauri/icons/${filename}`, { width: size, height: size });
  }
});

test("iOS and Android key icon files are present", () => {
  const iosFiles = [
    "AppIcon-20x20@1x.png",
    "AppIcon-20x20@2x.png",
    "AppIcon-20x20@3x.png",
    "AppIcon-29x29@1x.png",
    "AppIcon-29x29@2x.png",
    "AppIcon-29x29@3x.png",
    "AppIcon-40x40@1x.png",
    "AppIcon-40x40@2x.png",
    "AppIcon-40x40@3x.png",
    "AppIcon-60x60@2x.png",
    "AppIcon-60x60@3x.png",
    "AppIcon-76x76@1x.png",
    "AppIcon-76x76@2x.png",
    "AppIcon-83.5x83.5@2x.png",
    "AppIcon-512@2x.png",
  ];
  for (const filename of iosFiles) {
    resolveAsset(`src-tauri/icons/ios/${filename}`);
  }

  const androidDensities = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
  const androidFiles = ["ic_launcher.png", "ic_launcher_foreground.png", "ic_launcher_round.png"];
  for (const density of androidDensities) {
    for (const filename of androidFiles) {
      resolveAsset(`src-tauri/icons/android/mipmap-${density}/${filename}`);
    }
  }
});

test("DMG backgrounds keep normal and Retina dimensions", () => {
  assertPng("src-tauri/icons/dmg-background.png", { width: 660, height: 400 });
  assertPng("src-tauri/icons/dmg-background@2x.png", { width: 1320, height: 800 });
});

test("English and Chinese READMEs reference the public doge icon", () => {
  for (const readme of ["README.md", "README.zh-CN.md"]) {
    const content = readFileSync(resolve(ROOT, readme), "utf8");
    assert.match(content, /src=["']\.\/public\/app-icon\.png["']/);
  }
});
