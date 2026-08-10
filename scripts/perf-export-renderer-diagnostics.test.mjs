import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function runScript(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "node",
      ["scripts/perf-export-renderer-diagnostics.mjs", ...args],
      { cwd: process.cwd() },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

test("exports renderer diagnostics from app client store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ccgui-renderer-diagnostics-"));
  const inputPath = join(dir, "app.json");
  const outputPath = join(dir, "diagnostics.json");
  await writeFile(
    inputPath,
    JSON.stringify({
      "diagnostics.rendererLifecycleLog": [
        {
          timestamp: 1,
          label: "realtime.turnTrace.summary",
          payload: {
            evidenceClass: "measured",
            counters: {
              deltaCount: 2,
              reducerCommitCount: 2,
            },
          },
        },
        {
          timestamp: "bad",
          label: "bad-entry",
          payload: {},
        },
      ],
    }),
    "utf-8",
  );

  await runScript([`--input=${inputPath}`, `--output=${outputPath}`]);

  const fragment = JSON.parse(await readFile(outputPath, "utf-8"));
  assert.equal(fragment.source, "doge-client-store");
  assert.equal(fragment.entries.length, 1);
  assert.equal(fragment.entries[0]?.label, "realtime.turnTrace.summary");
  assert.match(fragment.notes.join("\n"), /turnTraceSummaryCount=1/);
});
