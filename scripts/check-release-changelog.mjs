#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCurrentReleaseNotes,
  readReleaseVersionFacts,
  validateReleaseChangelog,
} from "./lib/releaseChangelog.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const extractIndex = args.indexOf("--extract-current");
const extractOutput = extractIndex >= 0 ? args[extractIndex + 1] : null;
if (extractIndex >= 0 && !extractOutput) {
  console.error("--extract-current requires an output path");
  process.exit(2);
}

const { facts, failures: factFailures } = readReleaseVersionFacts(ROOT);
const markdown = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
const result = validateReleaseChangelog({ markdown, versionFacts: facts });
const failures = [...factFailures, ...result.failures];
if (failures.length > 0) {
  console.error("Release changelog check failed:\n");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

if (extractOutput) {
  const outputPath = resolve(ROOT, extractOutput);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buildCurrentReleaseNotes(result.currentEntry), "utf8");
  console.log(`Release notes extracted: v${result.canonicalVersion} -> ${extractOutput}`);
} else {
  console.log(
    `Release changelog check passed: v${result.canonicalVersion}, ${result.entries.length} entries.`,
  );
}
