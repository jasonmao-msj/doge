import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseVitestBatchConfig, testBatchedInternals } from "./test-batched.mjs";

function workflowJob(workflow, jobName) {
  const header = `  ${jobName}:\n`;
  const start = workflow.indexOf(header);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);
  const remainder = workflow.slice(start + header.length);
  const nextJob = remainder.search(/^  [a-zA-Z_][a-zA-Z0-9_]*:\n/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}

test("enables heavy integration suites via explicit CLI flag", () => {
  const config = parseVitestBatchConfig(["--include-heavy"], {
    VITEST_BATCH_SIZE: "6",
  });

  assert.deepEqual(config, {
    batchSize: 6,
    includeHeavyIntegration: true,
    retry: 0,
  });
});

test("keeps env-based heavy integration fallback for CI callers", () => {
  const config = parseVitestBatchConfig([], {
    VITEST_BATCH_SIZE: "4",
    VITEST_INCLUDE_HEAVY: "1",
    VITEST_RETRY: "1",
  });

  assert.deepEqual(config, {
    batchSize: 4,
    includeHeavyIntegration: true,
    retry: 1,
  });
});

test("rejects unsupported CLI arguments", () => {
  assert.throws(
    () => parseVitestBatchConfig(["--unknown"], { VITEST_BATCH_SIZE: "4" }),
    /Unknown argument: --unknown/,
  );
});

test("rejects partial and fractional batch sizes", () => {
  assert.throws(
    () => parseVitestBatchConfig([], { VITEST_BATCH_SIZE: "4abc" }),
    /Invalid VITEST_BATCH_SIZE: 4abc/,
  );
  assert.throws(
    () => parseVitestBatchConfig([], { VITEST_BATCH_SIZE: "1.5" }),
    /Invalid VITEST_BATCH_SIZE: 1.5/,
  );
});

test("rejects invalid or unbounded test retry values", () => {
  for (const retry of ["-1", "1.5", "4", "abc"]) {
    assert.throws(
      () => parseVitestBatchConfig([], { VITEST_BATCH_SIZE: "4", VITEST_RETRY: retry }),
      new RegExp(`Invalid VITEST_RETRY: ${retry.replace(".", "\\.")}`),
    );
  }
});

test("adds Vitest retry arguments only when explicitly enabled", () => {
  assert.deepEqual(testBatchedInternals.vitestRetryArgs(0), []);
  assert.deepEqual(testBatchedInternals.vitestRetryArgs(1), ["--retry", "1"]);
});

test("enables one retry only for the full batched CI lanes", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const jsJob = workflowJob(workflow, "test-js");
  const windowsJob = workflowJob(workflow, "test-windows");
  const withoutBatchedJobs = workflow
    .replace(`  test-js:\n${jsJob}`, "")
    .replace(`  test-windows:\n${windowsJob}`, "");

  assert.match(jsJob, /VITEST_RETRY: "1"/);
  assert.match(jsJob, /run: npm run test/);
  assert.equal(packageJson.scripts.test, "node scripts/test-batched.mjs");
  assert.match(windowsJob, /VITEST_RETRY: "1"/);
  assert.match(windowsJob, /run: node scripts\/test-batched\.mjs/);
  assert.doesNotMatch(withoutBatchedJobs, /VITEST_RETRY/);
});

test("normalizes ripgrep file output across line endings", () => {
  assert.deepEqual(
    testBatchedInternals.parseRipgrepFileList("src/b.test.tsx\r\nsrc/a.test.ts\n\n"),
    ["src/a.test.ts", "src/b.test.tsx"],
  );
});

test("quotes login-shell ripgrep arguments safely", () => {
  assert.equal(testBatchedInternals.shellQuote("src/path with ' quote"), "'src/path with '\\'' quote'");
});

test("treats shell exit 127 command-not-found as a recoverable ripgrep miss", () => {
  assert.equal(
    testBatchedInternals.isCommandNotFound({
      status: 127,
      stderr: "zsh:1: command not found: rg\n",
      message: "Command failed: zsh -lc rg --files",
    }),
    true,
  );
});

test("does not hide non-command-not-found shell failures", () => {
  assert.equal(
    testBatchedInternals.isCommandNotFound({
      status: 127,
      stderr: "permission denied\n",
      message: "Command failed: zsh -lc rg --files",
    }),
    false,
  );
});
