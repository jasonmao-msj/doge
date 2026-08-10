import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { brand } from "../../../config/brand";

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("canonical doge brand manifest", () => {
  it("defines the independent doge identity", () => {
    expect(brand).toMatchObject({
      schemaVersion: 1,
      name: "doge",
      developmentName: "doge-dev",
      tagline: "把复杂的事，叼回来做好。",
      version: "0.1.0",
      repository: {
        owner: "jasonmao-msj",
        name: "doge",
      },
      bundle: {
        productionIdentifier: "io.github.jasonmao-msj.doge",
        developmentIdentifier: "io.github.jasonmao-msj.doge.dev",
      },
      runtime: {
        appHomeDirectory: ".doge",
        mainBinary: "doge",
        daemonBinary: "doge_daemon",
        cargoPackage: "doge",
        cargoLibrary: "doge_lib",
        npmPackage: "doge",
      },
      visual: {
        mascot: "anthropomorphic-ai-shiba",
        iconConcept: "A",
        masterIcon: "src-tauri/icons/doge-icon-master.png",
        appIconSource: "src-tauri/icons/app-icon-source.png",
        colors: {
          shibaOrange: "#F4A62A",
          cream: "#FFF4DC",
          midnightNavy: "#0A1F34",
          aiTeal: "#2B9A92",
        },
      },
      updater: { enabled: false },
    });
  });

  it("keeps npm and Tauri metadata equal to the manifest", () => {
    const packageJson = readJson("package.json");
    const tauriConfig = readJson("src-tauri/tauri.conf.json") as {
      productName?: string;
      version?: string;
      identifier?: string;
    };
    const tauriDevConfig = readJson("src-tauri/tauri.dev.conf.json") as {
      productName?: string;
      version?: string;
      identifier?: string;
    };

    expect(packageJson.name).toBe(brand.runtime.npmPackage);
    expect(packageJson.version).toBe(brand.version);
    expect(tauriConfig).toMatchObject({
      productName: brand.name,
      version: brand.version,
      identifier: brand.bundle.productionIdentifier,
    });
    expect(tauriDevConfig).toMatchObject({
      productName: brand.developmentName,
      identifier: brand.bundle.developmentIdentifier,
    });
  });

  it("keeps Cargo package, library, and binaries equal to the manifest", () => {
    const cargoToml = readFileSync(resolve(process.cwd(), "src-tauri/Cargo.toml"), "utf8");

    expect(cargoToml).toContain(`name = "${brand.runtime.cargoPackage}"`);
    expect(cargoToml).toContain(`version = "${brand.version}"`);
    expect(cargoToml).toContain(`default-run = "${brand.runtime.mainBinary}"`);
    expect(cargoToml).toContain(`name = "${brand.runtime.cargoLibrary}"`);
    expect(cargoToml).toContain(`name = "${brand.runtime.daemonBinary}"`);
  });
});
