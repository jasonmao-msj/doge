import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("update release configuration", () => {
  it("keeps updater artifacts and trust config disabled until doge signing is ready", () => {
    const config = JSON.parse(readWorkspaceFile("src-tauri/tauri.conf.json")) as {
      bundle?: { createUpdaterArtifacts?: boolean };
      plugins?: {
        updater?: { endpoints?: string[]; pubkey?: string; active?: boolean };
      };
    };
    const windowsConfig = JSON.parse(
      readWorkspaceFile("src-tauri/tauri.windows.conf.json"),
    ) as { bundle?: { createUpdaterArtifacts?: boolean } };

    expect(config.bundle?.createUpdaterArtifacts).toBe(false);
    expect(windowsConfig.bundle?.createUpdaterArtifacts).toBe(false);
    expect(config.plugins?.updater).toEqual({ endpoints: [], pubkey: "" });
    expect(config.plugins?.updater?.active).not.toBe(true);
  });

  it("generates release asset URLs from the doge repo", () => {
    const workflow = readWorkspaceFile(".github/workflows/release.yml");

    expect(workflow).toContain("jasonmao-msj/doge/releases/download");
    expect(workflow).not.toContain("zhukunpenglinyutong/desktop-cc-gui");
    expect(workflow).toContain("release_preflight:");
    expect(workflow).toContain("needs: release_preflight");
    expect(workflow).toContain("needs.release_preflight.result == 'success'");
    expect(workflow).toContain("doge_aarch64.app.tar.gz.sig");
    expect(workflow).toContain("doge_x86_64.app.tar.gz.sig");
    expect(workflow).toContain("Missing Linux updater signature");
    expect(workflow).toContain("Missing Windows updater signature");
  });
});
