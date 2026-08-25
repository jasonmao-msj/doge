import { spawn } from "node:child_process";
import process from "node:process";
import { assertNoConflictingPackagedDogeApp } from "./tauri-dev-hot.mjs";

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
const tauriBin = process.platform === "win32" ? "tauri.cmd" : "tauri";
const isolatedConfig = JSON.stringify({
  build: {
    devUrl: `http://localhost:${isolatedPort}`,
  },
});

const child = spawn(
  tauriBin,
  ["dev", "--config", isolatedConfig],
  {
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
