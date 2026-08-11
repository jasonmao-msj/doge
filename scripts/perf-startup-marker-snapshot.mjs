#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_INPUT_PATH = ".artifacts/startup-marker-source.json";
const DEFAULT_OUTPUT_PATH = ".artifacts/startup-markers.json";

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

function hasStartupMarkerShape(value) {
  return isRecord(value)
    && value.source === "startup-perf-markers"
    && Array.isArray(value.markers);
}

function collectEntries(input) {
  if (Array.isArray(input)) {
    return input;
  }
  if (!isRecord(input)) {
    return [];
  }
  for (const key of ["entries", "diagnostics", "rendererDiagnostics", "rendererLifecycleLog"]) {
    if (Array.isArray(input[key])) {
      return input[key];
    }
  }
  if (isRecord(input.app) && Array.isArray(input.app.diagnostics?.rendererLifecycleLog)) {
    return input.app.diagnostics.rendererLifecycleLog;
  }
  return [];
}

function normalizeSnapshot(snapshot) {
  if (!hasStartupMarkerShape(snapshot)) {
    return null;
  }
  const markers = snapshot.markers
    .filter((marker) => isRecord(marker))
    .map((marker) => ({
      name: marker.name,
      atMs: typeof marker.atMs === "number" && Number.isFinite(marker.atMs)
        ? Number(marker.atMs.toFixed(2))
        : null,
    }))
    .filter((marker) =>
      (marker.name === "first-paint" || marker.name === "first-interactive")
      && marker.atMs !== null
    );
  if (markers.length === 0) {
    return null;
  }
  return {
    schemaVersion: snapshot.schemaVersion === "1.0" ? "1.0" : "1.0",
    source: "startup-perf-markers",
    markers,
    platform: typeof snapshot.platform === "string" ? snapshot.platform.slice(0, 80) : "unknown",
  };
}

function extractStartupSnapshot(input) {
  const direct = normalizeSnapshot(input);
  if (direct) {
    return direct;
  }
  if (isRecord(input)) {
    for (const key of ["startupPerf", "startupPerfSnapshot", "__DOGE_STARTUP_PERF__"]) {
      const nested = normalizeSnapshot(input[key]);
      if (nested) {
        return nested;
      }
    }
  }
  const entries = collectEntries(input);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry) || entry.label !== "perf.startup.markers") {
      continue;
    }
    const snapshot = normalizeSnapshot(entry.payload);
    if (snapshot) {
      return snapshot;
    }
  }
  return null;
}

async function writeJson(path, value) {
  const absolutePath = resolve(process.cwd(), path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function main() {
  const inputPath = getArgValue("--input") ?? DEFAULT_INPUT_PATH;
  const outputPath = getArgValue("--output") ?? DEFAULT_OUTPUT_PATH;
  const input = existsSync(resolve(process.cwd(), inputPath))
    ? JSON.parse(await readFile(resolve(process.cwd(), inputPath), "utf-8"))
    : null;
  const snapshot = extractStartupSnapshot(input);
  if (!snapshot) {
    throw new Error(`No startup marker snapshot found in ${inputPath}`);
  }
  await writeJson(outputPath, snapshot);
  if (process.argv.includes("--verbose")) {
    console.info(`startup marker snapshot written: ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
