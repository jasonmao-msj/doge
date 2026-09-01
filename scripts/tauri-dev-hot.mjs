import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const tauriCliScriptPath = path.resolve(
  repoRoot,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);
const devFrontendCommand = "node scripts/tauri-dev-frontend.mjs";
const devResourceScripts = [
  "scripts/prepare-bundled-engines.mjs",
  "scripts/prepare-wechat-bridge.mjs",
];

export function findConflictingPackagedDogeProcesses(psOutput) {
  return String(psOutput)
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*(\d+)\s+(.+)$/u))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), command: match[2].trim() }))
    .filter(({ command }) =>
      command.toLowerCase().includes("/doge.app/contents/macos/doge"),
    );
}

export function assertNoConflictingPackagedDogeApp() {
  if (process.platform !== "darwin") {
    return;
  }

  let psOutput;
  try {
    psOutput = execFileSync("/bin/ps", ["-axo", "pid=,command="], {
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(
      `unable to inspect running Doge processes: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const conflicts = findConflictingPackagedDogeProcesses(psOutput);
  if (conflicts.length === 0) {
    return;
  }

  const details = conflicts
    .map(({ pid, command }) => `  PID ${pid}: ${command}`)
    .join("\n");
  throw new Error(
    [
      "a packaged Doge app is already running and would capture the shared single-instance identity.",
      "Quit that Doge window, then run npm run tauri:dev:hot again.",
      details,
    ].join("\n"),
  );
}

export function getTauriSpawnSpec(platform = process.platform, args = []) {
  if (platform === "win32") {
    return {
      command: process.execPath,
      args: [tauriCliScriptPath, "dev", ...args],
    };
  }

  return {
    command: "tauri",
    args: ["dev", ...args],
  };
}

export function prepareDevResources() {
  for (const script of devResourceScripts) {
    execFileSync(process.execPath, [path.resolve(repoRoot, script)], {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });
  }
}

export function getHotDevTauriArgs(args = []) {
  return [
    "--config",
    JSON.stringify({
      build: {
        beforeDevCommand: devFrontendCommand,
      },
    }),
    ...args,
  ];
}

export function startTauriDev(args = process.argv.slice(2)) {
  assertNoConflictingPackagedDogeApp();
  prepareDevResources();
  const { command, args: spawnArgs } = getTauriSpawnSpec(
    process.platform,
    getHotDevTauriArgs(args),
  );
  const child = spawn(command, spawnArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  child.once("error", (error) => {
    console.error(`tauri-dev-hot: failed to start tauri\n${error.message}`);
    process.exit(1);
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    startTauriDev();
  } catch (error) {
    console.error(
      `tauri-dev-hot: refused to start\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}
