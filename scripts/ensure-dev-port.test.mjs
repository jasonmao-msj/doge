import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWindowsListeningPids,
  terminatePortPids,
} from "./ensure-dev-port.mjs";

test("parses only the Windows process listening on the requested local port", () => {
  const output = [
    "TCP    [::1]:1420       [::]:0          LISTENING       10556",
    "TCP    [::1]:55018      [::1]:1420      TIME_WAIT       0",
    "TCP    127.0.0.1:55019  127.0.0.1:1420  ESTABLISHED     22000",
    "TCP    127.0.0.1:18789  0.0.0.0:0       LISTENING       33000",
  ].join("\r\n");

  assert.deepEqual(parseWindowsListeningPids(output, 1420), [10556]);
});

test("force-terminates a dev server when graceful Windows taskkill fails", () => {
  const calls = [];
  const terminated = terminatePortPids([10556], (pid, force = false) => {
    calls.push({ pid, force });
    return force;
  });

  assert.equal(terminated, true);
  assert.deepEqual(calls, [
    { pid: 10556, force: false },
    { pid: 10556, force: true },
  ]);
});
