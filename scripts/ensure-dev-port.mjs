import net from "node:net";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

const DEFAULT_PORT = 1420;
const RETRY_ATTEMPTS = 10;
const RETRY_DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canListenOnHost(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      if (error && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")) {
        resolve(true);
        return;
      }
      resolve(false);
    });
    server.listen({ port, host }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function isPortFree(port) {
  const hosts = ["127.0.0.1", "::1"];
  for (const host of hosts) {
    const available = await canListenOnHost(port, host);
    if (!available) {
      return false;
    }
  }
  return true;
}

function getPidsFromPortUnix(port) {
  const result = spawnSync("lsof", ["-ti", `tcp:${port}`], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  return result.stdout
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function getPidsFromPortWindows(port) {
  const result = spawnSync(
    "cmd",
    ["/c", `netstat -ano -p tcp | findstr :${port}`],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  return parseWindowsListeningPids(result.stdout, port);
}

export function parseWindowsListeningPids(output, port) {
  const lines = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pids = new Set();
  for (const line of lines) {
    const cols = line.split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== "TCP") continue;
    const localEndpoint = cols[1];
    const localPort = Number.parseInt(
      localEndpoint.slice(localEndpoint.lastIndexOf(":") + 1),
      10,
    );
    if (localPort !== port || cols[3].toUpperCase() !== "LISTENING") continue;
    const pidText = cols[cols.length - 1];
    const pid = Number.parseInt(pidText, 10);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }
  return [...pids];
}

function getCommandLineUnix(pid) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}

function canAutoTerminate(commandLine) {
  const normalized = commandLine.toLowerCase();
  return (
    normalized.includes("vite") ||
    normalized.includes("tauri") ||
    normalized.includes("npm run dev") ||
    normalized.includes("pnpm dev") ||
    normalized.includes("yarn dev")
  );
}

function terminatePid(pid, force = false) {
  if (process.platform === "win32") {
    const args = force
      ? ["/PID", String(pid), "/T", "/F"]
      : ["/PID", String(pid), "/T"];
    const result = spawnSync("taskkill", args, {
      stdio: "ignore",
    });
    return result.status === 0;
  }

  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export function terminatePortPids(pids, terminate = terminatePid) {
  let terminatedAny = false;
  for (const pid of pids) {
    terminatedAny = terminate(pid) || terminatedAny;
  }
  if (terminatedAny) return true;

  for (const pid of pids) {
    terminatedAny = terminate(pid, true) || terminatedAny;
  }
  return terminatedAny;
}

async function releasePort(port) {
  const pids = process.platform === "win32"
    ? getPidsFromPortWindows(port)
    : getPidsFromPortUnix(port);
  const uniquePids = [...new Set(pids)].filter((pid) => pid !== process.pid);
  if (uniquePids.length === 0) {
    return false;
  }

  const terminablePids = uniquePids.filter((pid) => {
    if (process.platform === "win32") return true;
    const commandLine = getCommandLineUnix(pid);
    return !commandLine || canAutoTerminate(commandLine);
  });
  const terminatedAny = terminatePortPids(terminablePids);

  if (!terminatedAny) {
    return false;
  }

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    if (await isPortFree(port)) {
      return true;
    }
    await sleep(RETRY_DELAY_MS);
  }

  for (const pid of uniquePids) {
    terminatePid(pid, true);
  }
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    if (await isPortFree(port)) {
      return true;
    }
    await sleep(RETRY_DELAY_MS);
  }
  return false;
}

async function main() {
  const rawPort = Number(process.env.MOSS_DEV_PORT ?? "");
  const port =
    process.env.MOSS_DEV_PORT_ISOLATED === "1"
      ? Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535
        ? rawPort
        : DEFAULT_PORT
      : DEFAULT_PORT;
  if (await isPortFree(port)) {
    return;
  }

  console.warn(`ensure-dev-port: port ${port} is in use, attempting to release it...`);
  const released = await releasePort(port);
  if (released) {
    console.warn(`ensure-dev-port: released port ${port}.`);
    return;
  }

  console.error(
    `ensure-dev-port: port ${port} is still occupied. Close the process using this port and retry.`,
  );
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    await main();
  } catch (error) {
    console.error(
      `ensure-dev-port: failed\n${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
