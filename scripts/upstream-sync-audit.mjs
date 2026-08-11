#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_ORIGIN_URL = "https://github.com/jasonmao-msj/doge.git";
export const EXPECTED_UPSTREAM_URL =
  "https://github.com/zhukunpenglinyutong/desktop-cc-gui.git";
export const DISABLED_PUSH_URL = "DISABLED";

const CONFIG_KEYS = Object.freeze({
  originUrl: "remote.origin.url",
  originPushUrl: "remote.origin.pushurl",
  upstreamUrl: "remote.upstream.url",
  upstreamPushUrl: "remote.upstream.pushurl",
});

function normalizeValues(output) {
  return String(output)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function readLocalConfigValues(key, run = execFileSync) {
  try {
    const output = run("git", ["config", "--local", "--get-all", key], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return normalizeValues(output);
  } catch (error) {
    if (error && typeof error === "object" && error.status === 1) return [];
    throw error;
  }
}

export function readRemoteTopology(readValues = readLocalConfigValues) {
  return Object.fromEntries(
    Object.entries(CONFIG_KEYS).map(([name, key]) => [name, readValues(key)]),
  );
}

function displayValues(values) {
  return values.length === 0 ? "<missing>" : values.join(", ");
}

function requireSingleValue(failures, label, values, expected) {
  if (values.length !== 1 || values[0] !== expected) {
    failures.push(
      `${label} must be ${expected}; received ${displayValues(values)}`,
    );
  }
}

export function auditRemoteTopology(topology) {
  const failures = [];
  requireSingleValue(
    failures,
    "remote.origin.url",
    topology.originUrl,
    EXPECTED_ORIGIN_URL,
  );
  requireSingleValue(
    failures,
    "remote.upstream.url",
    topology.upstreamUrl,
    EXPECTED_UPSTREAM_URL,
  );
  requireSingleValue(
    failures,
    "remote.upstream.pushurl",
    topology.upstreamPushUrl,
    DISABLED_PUSH_URL,
  );

  if (
    topology.originPushUrl.length > 0 &&
    (topology.originPushUrl.length !== 1 ||
      topology.originPushUrl[0] !== EXPECTED_ORIGIN_URL)
  ) {
    failures.push(
      `remote.origin.pushurl must be absent or ${EXPECTED_ORIGIN_URL}; received ${displayValues(topology.originPushUrl)}`,
    );
  }

  return failures;
}

export function formatAuditReport(failures) {
  if (failures.length === 0) {
    return "Upstream sync audit passed: doge origin is canonical and upstream push is disabled.";
  }
  return [
    `Upstream sync audit failed (${failures.length} issue${failures.length === 1 ? "" : "s"}):`,
    ...failures.map((failure) => `- ${failure}`),
    "See docs/guides/workflow/upstream-sync.md for repair commands.",
  ].join("\n");
}

function main() {
  try {
    const failures = auditRemoteTopology(readRemoteTopology());
    const report = formatAuditReport(failures);
    if (failures.length > 0) {
      console.error(report);
      process.exitCode = 1;
      return;
    }
    console.log(report);
  } catch (error) {
    console.error(
      `Upstream sync audit could not read local Git config: ${error.message}`,
    );
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
