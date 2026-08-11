import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type BrandManifest = {
  repository: {
    url: string;
    issuesUrl: string;
  };
  updater: {
    endpoint: string;
    enabled: boolean;
  };
};

type TauriConfig = {
  app?: {
    security?: {
      csp?: string;
    };
  };
  bundle?: {
    createUpdaterArtifacts?: boolean;
  };
  plugins?: {
    updater?: { endpoints?: string[]; pubkey?: string; active?: boolean };
  };
};

const repoRoot = resolve(import.meta.dirname, "../../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function json<T>(relativePath: string): T {
  return JSON.parse(source(relativePath)) as T;
}

describe("doge external-service contracts", () => {
  it("removes every Baidu frontend, native, command-registry, and CSP entrypoint", () => {
    const removedModules = [
      "src/services/baiduTongji.ts",
      "src/services/tauri/baiduTongji.ts",
      "src-tauri/src/baidu_tongji.rs",
    ];
    removedModules.forEach((relativePath) => {
      expect(existsSync(resolve(repoRoot, relativePath)), relativePath).toBe(false);
    });

    const entrypointSources = [
      "src/main.tsx",
      "src/services/tauri.ts",
      "src-tauri/src/lib.rs",
      "src-tauri/src/command_registry.rs",
    ]
      .map(source)
      .join("\n");
    expect(entrypointSources).not.toMatch(
      /installBaiduTongji|BaiduTongjiState|baidu_tongji|load_baidu_tongji_script|send_baidu_tongji_beacon/u,
    );

    const tauriConfig = json<TauriConfig>("src-tauri/tauri.conf.json");
    const csp = tauriConfig.app?.security?.csp ?? "";
    expect(csp).not.toMatch(/hm\.baidu\.com|baiduTongji/iu);
  });

  it("ships no upstream relay default while retaining user-supplied provider URLs", () => {
    const providerSources = [
      "src/features/vendors/components/ProviderDialog.tsx",
      "src/services/tauri/vendors.ts",
      "src-tauri/src/vendors/commands.rs",
      "src-tauri/src/coding_plan_quota.rs",
    ]
      .map(source)
      .join("\n");
    expect(providerSources).not.toContain("fufei." + "mossx.ai");

    const dialog = source("src/features/vendors/components/ProviderDialog.tsx");
    expect(dialog).toContain('const CUSTOM_PROXY_PRESET_ID = "custom_proxy"');
    expect(dialog).toContain("return CUSTOM_PROXY_PRESET_ID");
    expect(dialog).toContain("fetchClaudeProviderModels(baseUrl, apiKey)");

    const frontendBridge = source("src/services/tauri/vendors.ts");
    expect(frontendBridge).toMatch(
      /fetchClaudeProviderModels\(\s*baseUrl: string,\s*apiKey: string,[\s\S]*?"vendor_fetch_claude_models"[\s\S]*?baseUrl,/u,
    );

    const backend = source("src-tauri/src/vendors/commands.rs");
    expect(backend).toContain("fn derive_model_list_candidates(base_url: &str)");
    expect(backend).toContain('format!("{base}/v1/models")');
    expect(backend).toContain("reqwest::Url::parse(&base)");
  });

  it("keeps About, feedback, Web assets, and update URLs on the canonical doge repository", () => {
    const brand = json<BrandManifest>("config/brand.json");
    const expectedUpdater = `${brand.repository.url}/releases/latest/download/latest.json`;
    const expectedWebAssetsBase = `${brand.repository.url}/releases/download`;

    expect(brand.repository.issuesUrl).toBe(`${brand.repository.url}/issues`);
    expect(brand.updater.endpoint).toBe(expectedUpdater);

    const about = source("src/features/about/components/AboutView.tsx");
    expect(about).toContain("DOGE_REPOSITORY_URL");
    expect(about).toContain("openUrl(DOGE_REPOSITORY_URL)");

    const community = source(
      "src/features/settings/components/settings-view/sections/CommunitySection.tsx",
    );
    expect(community).toContain("openUrl(DOGE_REPOSITORY_URL)");
    expect(community).toContain("openUrl(DOGE_ISSUES_URL)");
    expect(community).not.toMatch(/(?:wxq|WeChat|公众号|微信群)/iu);

    const errorReport = source("src/components/errorBoundaryReport.ts");
    expect(errorReport).toContain("DOGE_ISSUES_URL");
    expect(errorReport).toContain("`${DOGE_ISSUES_URL}/new`");

    const webAssets = source("src-tauri/src/web_service/assets_package.rs");
    expect(webAssets).toContain(`const RELEASE_REPOSITORY_URL: &str = "${expectedWebAssetsBase}"`);

    const releaseWorkflow = source(".github/workflows/release.yml");
    expect(releaseWorkflow).toContain(`${brand.repository.url}/releases/download/v`);
    expect(releaseWorkflow).not.toContain(
      "zhukunpenglinyutong/" + "desktop-cc-gui",
    );

    const tauriConfig = json<TauriConfig>("src-tauri/tauri.conf.json");
    expect(brand.updater.enabled).toBe(false);
    expect(tauriConfig.bundle?.createUpdaterArtifacts).toBe(false);
    expect(tauriConfig.plugins?.updater).toEqual({ endpoints: [], pubkey: "" });
    expect(tauriConfig.plugins?.updater?.active).not.toBe(true);
  });
});
