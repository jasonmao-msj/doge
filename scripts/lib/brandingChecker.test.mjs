import test from "node:test";
import assert from "node:assert/strict";

import { scanText, validateAllowlist } from "./brandingChecker.mjs";

test("doge-only shipping text passes", () => {
  assert.deepEqual(scanText("src/example.ts", "export const product = 'doge';", []), []);
});

test("upstream service and legacy product text fail with exact locations", () => {
  const offenders = scanText(
    "src/example.ts",
    "const repo = 'zhukunpenglinyutong/desktop-cc-gui';\nconst product = 'ccgui';\nconst cache = '.moss-x-cache';",
    [],
  );
  assert.deepEqual(
    offenders.map(({ line, token }) => [line, token]),
    [
      [1, "upstream-repository"],
      [1, "legacy-brand"],
      [2, "legacy-brand"],
      [3, "legacy-brand"],
    ],
  );
});

test("reasoned narrow compatibility entry allows only its matching line", () => {
  const allowlist = [
    {
      path: /^src\/migration\.ts$/,
      line: /legacyKey = "ccgui\.value"/,
      tokens: ["legacy-brand"],
      category: "compatibility-reader",
      reason: "Reads one historical key.",
      removalCondition: "Remove after a dedicated migration-removal change.",
    },
  ];
  const content = 'const legacyKey = "ccgui.value";\nconst title = "ccgui";';
  const offenders = scanText("src/migration.ts", content, allowlist);
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].line, 2);
});

test("allowlist entries require reason and removal condition", () => {
  assert.throws(
    () =>
      validateAllowlist([
        {
          path: /^src\/migration\.ts$/,
          line: /ccgui/,
          tokens: ["legacy-brand"],
          category: "compatibility-reader",
          reason: "",
          removalCondition: "",
        },
      ]),
    /missing reason/,
  );
});
