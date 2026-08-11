import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const shippingRoots = [
  "src",
  "src-tauri/src",
  "src-tauri/Info.plist",
  "src-tauri/infoplist",
  "src-tauri/tauri.conf.json",
  ".github/workflows",
  "public",
  "scripts",
];
const sourceExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".plist",
  ".rs",
  ".sh",
  ".strings",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);
const developerOnlyUpstreamProvenance = new Set([
  "scripts/lib/brandingChecker.mjs",
  "scripts/upstream-sync-audit.mjs",
  "src/features/subagent-ui/constants/personaAuthorPool.ts",
  "src/features/subagent-ui/constants/personaAvatarAssets.ts",
]);

function collectShippingFiles(path: string): string[] {
  const absolutePath = join(repoRoot, path);
  if (!statSync(absolutePath).isDirectory()) {
    return [absolutePath];
  }
  return readdirSync(absolutePath).flatMap((entry) => {
    const child = join(absolutePath, entry);
    if (statSync(child).isDirectory()) {
      return entry === "dist" ? [] : collectShippingFiles(relative(repoRoot, child));
    }
    if (!sourceExtensions.has(extname(entry))) {
      return [];
    }
    if (/\.(?:test|spec)\.[^.]+$/u.test(entry)) {
      return [];
    }
    return [child];
  });
}

function findForbiddenOccurrences(needles: string[]) {
  return shippingRoots
    .flatMap(collectShippingFiles)
    .flatMap((absolutePath) => {
      const repoPath = relative(repoRoot, absolutePath);
      if (developerOnlyUpstreamProvenance.has(repoPath)) {
        return [];
      }
      const source = readFileSync(absolutePath, "utf8").toLowerCase();
      return needles
        .filter((needle) => source.includes(needle.toLowerCase()))
        .map((needle) => `${repoPath}: ${needle}`);
    });
}

describe("upstream service isolation", () => {
  it("ships no upstream analytics, managed relay, repository, or release endpoint", () => {
    expect(
      findForbiddenOccurrences([
        "hm.baidu" + ".com",
        "baidu" + "_tongji",
        "baidu" + "Tongji",
        "fufei." + "mossx.ai",
        "zhukunpenglinyutong/" + "desktop-cc-gui",
      ]),
    ).toEqual([]);
  });

  it("keeps the updater fail-closed until doge signing is configured", () => {
    const config = JSON.parse(
      readFileSync(join(repoRoot, "src-tauri/tauri.conf.json"), "utf8"),
    ) as {
      bundle?: { createUpdaterArtifacts?: boolean };
      plugins?: {
        updater?: { endpoints?: string[]; pubkey?: string; active?: boolean };
      };
    };
    const windowsConfig = JSON.parse(
      readFileSync(join(repoRoot, "src-tauri/tauri.windows.conf.json"), "utf8"),
    ) as { bundle?: { createUpdaterArtifacts?: boolean } };

    expect(config.bundle?.createUpdaterArtifacts).toBe(false);
    expect(windowsConfig.bundle?.createUpdaterArtifacts).toBe(false);
    expect(config.plugins?.updater).toEqual({ endpoints: [], pubkey: "" });
    expect(config.plugins?.updater?.active).not.toBe(true);
  });
});
