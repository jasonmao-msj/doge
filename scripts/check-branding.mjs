#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scanRepository,
  verifyCanonicalIdentity,
} from "./lib/brandingChecker.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const INCLUDE_PATHS = [
  "src",
  "src-tauri/src",
  "src-tauri/Info.plist",
  "src-tauri/infoplist",
  "scripts",
  ".github/workflows/release.yml",
  "README.md",
  "README.zh-CN.md",
  "package.json",
  "package-lock.json",
  "flake.nix",
  "skills-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.dev.conf.json",
  "src-tauri/tauri.windows.conf.json",
];

const { failures: identityFailures } = verifyCanonicalIdentity(ROOT);
const offenders = scanRepository(ROOT, INCLUDE_PATHS);

if (identityFailures.length > 0 || offenders.length > 0) {
  console.error("Branding check failed.\n");
  for (const failure of identityFailures) {
    console.error(`identity: ${failure}`);
  }
  for (const offender of offenders) {
    console.error(
      `${offender.path}:${offender.line} [${offender.token}] ${offender.source}`,
    );
  }
  process.exit(1);
}

console.log("Branding check passed: canonical identity and legacy-service scan are clean.");
