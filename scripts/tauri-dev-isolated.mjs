import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertNoConflictingPackagedDogeApp,
  getTauriSpawnSpec,
  prepareDevResources,
} from "./tauri-dev-hot.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function resolveIsolatedPort() {
  const rawPort = process.env.MOSS_DEV_PORT ?? "";
  const port = rawPort.trim() === "" ? 1430 : Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`tauri-dev-isolated: invalid MOSS_DEV_PORT "${rawPort}"`);
    process.exit(1);
  }
  return String(port);
}

const isolatedPort = resolveIsolatedPort();
assertNoConflictingPackagedDogeApp();
prepareDevResources();
const isolatedConfig = JSON.stringify({
  build: {
    devUrl: `http://localhost:${isolatedPort}`,
    beforeDevCommand: "node scripts/tauri-dev-frontend.mjs",
  },
});
const { command, args } = getTauriSpawnSpec(process.platform, [
  "--config",
  isolatedConfig,
]);

const child = spawn(
  command,
  args,
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      MOSS_DEV_PORT: isolatedPort,
      MOSS_DEV_PORT_ISOLATED: "1",
    },
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error(`tauri-dev-isolated: failed to start tauri\n${error.message}`);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
