#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

const DEFAULT_INPUT_PATH = `${homedir()}/.doge/client/app.json`;
const DEFAULT_OUTPUT_PATH = ".artifacts/realtime-runtime-diagnostics.json";
const DIAGNOSTICS_KEY = "diagnostics.rendererLifecycleLog";

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index !== -1) {
    return process.argv[index + 1] ?? null;
  }
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDiagnosticEntry(value) {
  if (!isRecord(value)) {
    return null;
  }
  const { timestamp, label, payload } = value;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || typeof label !== "string") {
    return null;
  }
  return {
    timestamp,
    label,
    payload: isRecord(payload) ? payload : {},
  };
}

function collectRendererDiagnostics(appStore) {
  if (!isRecord(appStore)) {
    return [];
  }
  const entries = appStore[DIAGNOSTICS_KEY];
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.flatMap((entry) => {
    const normalized = normalizeDiagnosticEntry(entry);
    return normalized ? [normalized] : [];
  });
}

async function writeJson(path, value) {
  const absolutePath = resolve(process.cwd(), path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function main() {
  const inputPath = getArgValue("--input") ?? DEFAULT_INPUT_PATH;
  const outputPath = getArgValue("--output") ?? DEFAULT_OUTPUT_PATH;
  const absoluteInputPath = resolve(process.cwd(), inputPath);
  if (!existsSync(absoluteInputPath)) {
    throw new Error(`client app store not found: ${inputPath}`);
  }

  const appStore = JSON.parse(await readFile(absoluteInputPath, "utf-8"));
  const entries = collectRendererDiagnostics(appStore);
  const turnTraceSummaryCount = entries.filter(
    (entry) => entry.label === "realtime.turnTrace.summary",
  ).length;
  await writeJson(outputPath, {
    schemaVersion: "1.0",
    source: "doge-client-store",
    inputPath,
    generatedAt: new Date().toISOString(),
    entries,
    notes: [
      `diagnosticEntryCount=${entries.length}`,
      `turnTraceSummaryCount=${turnTraceSummaryCount}`,
      "contentSafety=renderer diagnostics are bounded by rendererDiagnostics.ts; downstream perf producers whitelist metric fields before reporting",
    ],
  });
  if (process.argv.includes("--verbose")) {
    console.info(
      `renderer diagnostics exported: ${outputPath} entries=${entries.length} turnTraceSummaryCount=${turnTraceSummaryCount}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
