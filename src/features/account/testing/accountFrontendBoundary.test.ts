import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ACCOUNT_ROOT = "src/features/account";

function collectLeafSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "contracts" ? [] : collectLeafSources(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test.")
      ? [path]
      : [];
  });
}

describe("Account frontend boundary", () => {
  it("keeps consumer components behind the AccountGatewayV1 provider", () => {
    const consumer = readFileSync(
      `${ACCOUNT_ROOT}/components/AccountGatewayConsumerShell.tsx`,
      "utf8",
    );
    const hook = readFileSync(
      `${ACCOUNT_ROOT}/hooks/useAccountGatewayContract.ts`,
      "utf8",
    );
    const provider = readFileSync(
      `${ACCOUNT_ROOT}/gateway/AccountGatewayProvider.tsx`,
      "utf8",
    );

    expect(consumer).not.toContain("../contracts");
    expect(consumer).not.toContain("MockAccountGatewayV1");
    expect(hook).not.toContain("../contracts");
    expect(provider).toContain(
      'import type { AccountGatewayV1 } from "../contracts/gateway"',
    );
    expect(provider).not.toMatch(/contracts\/(authority|broker|transport)/);
  });

  it("contains no production network, Tauri, or native call sites", () => {
    for (const path of collectLeafSources(ACCOUNT_ROOT)) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("@tauri-apps/");
      expect(source, path).not.toMatch(/services\/tauri/);
      expect(source, path).not.toMatch(/\bfetch\s*\(/);
      expect(source, path).not.toMatch(/\binvoke\s*\(/);
      expect(source, path).not.toMatch(/\bwindow\.open\s*\(/);
    }
  });
});
