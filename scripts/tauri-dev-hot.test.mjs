import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  findConflictingPackagedDogeProcesses,
  getHotDevTauriArgs,
  getTauriSpawnSpec,
} from "./tauri-dev-hot.mjs";

test("launches the Tauri JavaScript entrypoint directly on Windows", () => {
  const spec = getTauriSpawnSpec("win32", ["--help"]);

  assert.equal(spec.command, process.execPath);
  assert.deepEqual(spec.args, [
    path.resolve(
      process.cwd(),
      "node_modules",
      "@tauri-apps",
      "cli",
      "tauri.js",
    ),
    "dev",
    "--help",
  ]);
});

test("uses the tauri executable on non-Windows platforms", () => {
  assert.deepEqual(getTauriSpawnSpec("darwin"), {
    command: "tauri",
    args: ["dev"],
  });
});

test("prepares resources before Tauri starts waiting for the frontend", () => {
  const args = getHotDevTauriArgs(["--runner", "/tmp/signed-cargo"]);

  assert.equal(args[0], "--config");
  assert.deepEqual(JSON.parse(args[1]), {
    build: {
      beforeDevCommand: "node scripts/tauri-dev-frontend.mjs",
    },
  });
  assert.deepEqual(args.slice(2), ["--runner", "/tmp/signed-cargo"]);
});

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
