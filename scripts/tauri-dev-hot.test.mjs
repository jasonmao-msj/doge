import assert from "node:assert/strict";
import test from "node:test";
import { findConflictingPackagedDogeProcesses } from "./tauri-dev-hot.mjs";

test("detects packaged Doge processes that can capture the dev single-instance identity", () => {
  const conflicts = findConflictingPackagedDogeProcesses(`
  101 /Applications/doge.app/Contents/MacOS/doge
  102 /Volumes/doge 12/doge.app/Contents/MacOS/doge --opened-from-dmg
  103 /workspace/doge/src-tauri/target/debug/doge
  104 node /workspace/doge/node_modules/.bin/tauri dev
`);

  assert.deepEqual(conflicts, [
    {
      pid: 101,
      command: "/Applications/doge.app/Contents/MacOS/doge",
    },
    {
      pid: 102,
      command:
        "/Volumes/doge 12/doge.app/Contents/MacOS/doge --opened-from-dmg",
    },
  ]);
});

test("ignores the canonical raw debug binary", () => {
  assert.deepEqual(
    findConflictingPackagedDogeProcesses(`
  201 target/debug/doge
  202 /workspace/doge/src-tauri/target/debug/doge
`),
    [],
  );
});
