import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("update release configuration", () => {
  it("ships the doge updater artifacts and trust config", () => {
    const config = JSON.parse(readWorkspaceFile("src-tauri/tauri.conf.json")) as {
      bundle?: { createUpdaterArtifacts?: boolean };
      plugins?: {
        updater?: { endpoints?: string[]; pubkey?: string; active?: boolean };
      };
    };
    const windowsConfig = JSON.parse(
      readWorkspaceFile("src-tauri/tauri.windows.conf.json"),
    ) as { bundle?: { createUpdaterArtifacts?: boolean } };

    expect(config.bundle?.createUpdaterArtifacts).toBe(true);
    expect(windowsConfig.bundle?.createUpdaterArtifacts).toBe(true);
    expect(config.plugins?.updater).toEqual({
      active: true,
      pubkey:
        "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDA4QjcxRkFFN0Q5NzgxQUYKUldTdmdaZDlyaCszQ0k2NGVoTG1LRnVoN2F3SVZjNFVzeTZlc2VNcUJhdlhmTko4WkY2QU9UQmMK",
      endpoints: [
        "https://github.com/jasonmao-msj/doge/releases/latest/download/latest.json",
      ],
    });
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
