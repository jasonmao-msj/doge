import assert from "node:assert/strict";
import test from "node:test";

import {
  DISABLED_PUSH_URL,
  EXPECTED_ORIGIN_URL,
  EXPECTED_UPSTREAM_URL,
  auditRemoteTopology,
  readLocalConfigValues,
  readRemoteTopology,
} from "./upstream-sync-audit.mjs";

function validTopology(overrides = {}) {
  return {
    originUrl: [EXPECTED_ORIGIN_URL],
    originPushUrl: [],
    upstreamUrl: [EXPECTED_UPSTREAM_URL],
    upstreamPushUrl: [DISABLED_PUSH_URL],
    ...overrides,
  };
}

test("accepts the canonical doge origin and read-only upstream", () => {
  assert.deepEqual(auditRemoteTopology(validTopology()), []);
});

test("rejects a missing or non-canonical upstream fetch URL", () => {
  const failures = auditRemoteTopology(validTopology({ upstreamUrl: [] }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /remote\.upstream\.url/);
  assert.match(failures[0], /<missing>/);

  const wrongUrlFailures = auditRemoteTopology(
    validTopology({ upstreamUrl: ["https://example.invalid/project.git"] }),
  );
  assert.equal(wrongUrlFailures.length, 1);
  assert.match(wrongUrlFailures[0], /example\.invalid/);
});

test("requires upstream push to fail closed", () => {
  const failures = auditRemoteTopology(
    validTopology({ upstreamPushUrl: [EXPECTED_UPSTREAM_URL] }),
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /remote\.upstream\.pushurl must be DISABLED/);
});

test("reads only local Git config keys without fetch or mutation", () => {
  const calls = [];
  const values = new Map([
    ["remote.origin.url", `${EXPECTED_ORIGIN_URL}\n`],
    ["remote.origin.pushurl", ""],
    ["remote.upstream.url", `${EXPECTED_UPSTREAM_URL}\n`],
    ["remote.upstream.pushurl", `${DISABLED_PUSH_URL}\n`],
  ]);
  const run = (program, args, options) => {
    calls.push({ program, args, options });
    return values.get(args.at(-1));
  };
  const topology = readRemoteTopology((key) => readLocalConfigValues(key, run));

  assert.deepEqual(topology, validTopology());
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.program, "git");
    assert.deepEqual(call.args.slice(0, 3), ["config", "--local", "--get-all"]);
    assert.equal(call.args.length, 4);
    assert.equal(call.options.encoding, "utf8");
  }
});
