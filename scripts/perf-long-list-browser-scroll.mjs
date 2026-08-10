#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OUTPUT_PATH = "docs/perf/long-list-browser-scroll.json";
const SCENARIO = "S-LL-1000";
const ROW_COUNT = 1000;
const TRACE_DURATION_MS = 1800;
const FRAME_BUDGET_MS = 16.67;
const verbose = process.argv.includes("--verbose");

function platformBrowserCandidates() {
  const envCandidates = [process.env.CHROME_BIN, process.env.BROWSER_BIN].filter(Boolean);
  if (process.platform === "darwin") {
    return [
      ...envCandidates,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    return [
      ...envCandidates,
      ...roots.map((root) => `${root}\\Google\\Chrome\\Application\\chrome.exe`),
      ...roots.map((root) => `${root}\\Microsoft\\Edge\\Application\\msedge.exe`),
    ];
  }
  return [
    ...envCandidates,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
}

function findBrowser() {
  return platformBrowserCandidates().find((candidate) => candidate && existsSync(candidate)) ?? null;
}

async function writeJson(path, value) {
  const absolutePath = resolve(process.cwd(), path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function metricFragment(metric) {
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    source: "long-list-browser-scroll",
    metrics: [metric],
    notes: [`platform=${process.platform}`],
  };
}

async function writeUnsupported(reason) {
  await writeJson(OUTPUT_PATH, metricFragment({
    scenario: SCENARIO,
    metric: "browserScrollFrameDropPct",
    value: null,
    unit: "%",
    unsupportedReason: reason,
  }));
}

function createHtml() {
  const rows = Array.from({ length: ROW_COUNT }, (_, index) => {
    const kind = index % 3 === 0 ? "message" : index % 3 === 1 ? "reasoning" : "tool";
    const tone = index % 2 === 0 ? "user" : "assistant";
    return `<article class="row ${kind}" data-index="${index}">
      <strong>${kind}:${index}</strong>
      <span>${tone} synthetic content ${index}</span>
      <code>${kind === "tool" ? "npm run typecheck" : "viewport projection sample"}</code>
    </article>`;
  }).join("\n");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>S-LL-1000 Browser Scroll Gate</title>
  <style>
    html, body { margin: 0; background: #f8fafc; color: #111827; font-family: Arial, sans-serif; }
    #scroller { width: 960px; height: 720px; overflow-y: auto; margin: 24px auto; border: 1px solid #cbd5e1; background: #ffffff; }
    .row { min-height: 52px; box-sizing: border-box; padding: 10px 14px; border-bottom: 1px solid #e5e7eb; display: grid; grid-template-columns: 180px 1fr 220px; gap: 12px; align-items: center; }
    .reasoning { background: #f9fafb; }
    .tool { background: #eff6ff; }
    code { color: #2563eb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style>
</head>
<body>
  <main id="scroller">${rows}</main>
  <script>
    window.runLongListScrollGate = async function runLongListScrollGate() {
      const scroller = document.getElementById("scroller");
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const intervals = [];
      let running = true;
      let lastFrameAt = performance.now();
      function observeFrame(now) {
        intervals.push(now - lastFrameAt);
        lastFrameAt = now;
        if (running) requestAnimationFrame(observeFrame);
      }
      requestAnimationFrame(observeFrame);
      const startedAt = performance.now();
      await new Promise((resolveFrame) => {
        function step(now) {
          const elapsed = now - startedAt;
          const progress = Math.min(1, elapsed / ${TRACE_DURATION_MS});
          scroller.scrollTop = Math.round(maxScrollTop * progress);
          if (progress < 1) {
            requestAnimationFrame(step);
            return;
          }
          resolveFrame();
        }
        requestAnimationFrame(step);
      });
      running = false;
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
      const durationMs = performance.now() - startedAt;
      const observed = intervals.filter((value) => value > 0);
      const droppedFrames = observed.reduce((total, interval) => (
        total + Math.max(0, Math.round(interval / ${FRAME_BUDGET_MS}) - 1)
      ), 0);
      const denominator = observed.length + droppedFrames;
      return {
        rowCount: ${ROW_COUNT},
        durationMs: Number(durationMs.toFixed(2)),
        frameCount: observed.length,
        droppedFrames,
        dropPct: denominator === 0 ? 0 : Number(((droppedFrames / denominator) * 100).toFixed(2)),
        viewportHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        finalScrollTop: scroller.scrollTop
      };
    };
  </script>
</body>
</html>`;
}

function waitForDevToolsUrl(processHandle) {
  return new Promise((resolveWait, rejectWait) => {
    let stderr = "";
    const timeout = setTimeout(() => {
      rejectWait(new Error("Timed out waiting for Chrome DevTools endpoint."));
    }, 10_000);
    processHandle.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolveWait(match[1]);
      }
    });
    processHandle.once("exit", (code) => {
      clearTimeout(timeout);
      rejectWait(new Error(`Browser exited before DevTools was ready: ${code ?? "unknown"}`));
    });
  });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    socket.addEventListener("message", (event) => this.handleMessage(JSON.parse(event.data)));
  }

  handleMessage(message) {
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    this.waiters = this.waiters.filter((waiter) => {
      if (waiter.method === message.method && (!waiter.sessionId || waiter.sessionId === message.sessionId)) {
        waiter.resolve(message);
        return false;
      }
      return true;
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
    });
  }

  waitFor(method, sessionId, timeoutMs = 10_000) {
    return new Promise((resolveWait, rejectWait) => {
      const timeout = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== resolveWait);
        rejectWait(new Error(`Timed out waiting for CDP event ${method}.`));
      }, timeoutMs);
      this.waiters.push({
        method,
        sessionId,
        resolve: (message) => {
          clearTimeout(timeout);
          resolveWait(message);
        },
      });
    });
  }
}

async function runBrowserGate(browserPath, htmlPath, userDataDir) {
  const browser = spawn(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-port=0",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const devToolsUrl = await waitForDevToolsUrl(browser);
    const socket = new WebSocket(devToolsUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", () => rejectOpen(new Error("Failed to connect to Chrome DevTools.")), { once: true });
    });
    const client = new CdpClient(socket);
    const target = await client.send("Target.createTarget", { url: "about:blank" });
    const attached = await client.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    const loadEvent = client.waitFor("Page.loadEventFired", sessionId);
    await client.send("Page.navigate", { url: pathToFileURL(htmlPath).href }, sessionId);
    await loadEvent;
    const evaluation = await client.send("Runtime.evaluate", {
      expression: "window.runLongListScrollGate()",
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    socket.close();
    return evaluation.result.value;
  } finally {
    browser.kill("SIGTERM");
  }
}

function normalizeBrowserGateResult(result) {
  if (!result || typeof result !== "object") {
    throw new Error("Browser scroll gate returned an invalid result payload.");
  }
  const dropPct = Number(result.dropPct);
  if (!Number.isFinite(dropPct) || dropPct < 0) {
    throw new Error("Browser scroll gate returned an invalid dropped-frame percentage.");
  }
  return {
    ...result,
    dropPct,
  };
}

async function main() {
  if (typeof WebSocket !== "function") {
    await writeUnsupported("Node.js WebSocket support is unavailable for dependency-free CDP transport.");
    return;
  }
  const browserPath = findBrowser();
  if (!browserPath) {
    await writeUnsupported("No supported Chrome/Chromium/Edge browser binary found. Set CHROME_BIN or BROWSER_BIN to enable browser scroll evidence.");
    return;
  }
  const tempDir = await mkdtemp(resolve(tmpdir(), "doge-long-list-scroll-"));
  try {
    const htmlPath = resolve(tempDir, "long-list-scroll.html");
    const userDataDir = resolve(tempDir, "profile");
    await writeFile(htmlPath, createHtml(), "utf-8");
    const result = normalizeBrowserGateResult(await runBrowserGate(browserPath, htmlPath, userDataDir));
    await writeJson(OUTPUT_PATH, metricFragment({
      scenario: SCENARIO,
      metric: "browserScrollFrameDropPct",
      value: result.dropPct,
      unit: "%",
      notes: `browser=${browserPath}`,
      details: result,
    }));
    if (verbose) {
      console.info(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    await writeUnsupported(error instanceof Error ? error.message : String(error));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main();
