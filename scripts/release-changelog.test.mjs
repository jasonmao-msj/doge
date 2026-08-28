import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCurrentReleaseNotes,
  parseReleaseChangelog,
  validateReleaseChangelog,
} from "./lib/releaseChangelog.mjs";

const validMarkdown = `# Changelog

### **2026年8月28日（v0.1.3）**

中文：

## 新功能
- 当前版本

English:

## New Features
- Current release

---

### **2026年8月27日（v0.1.2）**

中文：
- 上一版本

English:
- Previous release
`;

const versions = {
  brand: "0.1.3",
  package: "0.1.3",
  packageLock: "0.1.3",
  packageLockRoot: "0.1.3",
  tauri: "0.1.3",
  cargo: "0.1.3",
  cargoLock: "0.1.3",
};

test("parses bilingual release entries and extracts the current body", () => {
  const entries = parseReleaseChangelog(validMarkdown);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.version, "0.1.3");
  assert.match(entries[0]?.chineseBody ?? "", /当前版本/u);
  assert.match(entries[0]?.englishBody ?? "", /Current release/u);

  const result = validateReleaseChangelog({ markdown: validMarkdown, versionFacts: versions });
  assert.deepEqual(result.failures, []);
  assert.equal(
    buildCurrentReleaseNotes(result.currentEntry),
    "## 中文\n\n## 新功能\n- 当前版本\n\n## English\n\n## New Features\n- Current release\n",
  );
});

test("rejects version drift, missing language content, duplicates, and ascending history", () => {
  const drift = validateReleaseChangelog({
    markdown: validMarkdown,
    versionFacts: { ...versions, cargo: "0.1.2" },
  });
  assert.ok(drift.failures.some((failure) => failure.includes("cargo version 0.1.2")));

  const invalidMarkdown = validMarkdown
    .replace("## New Features\n- Current release", "")
    .replace("v0.1.2", "v0.1.3");
  const invalid = validateReleaseChangelog({ markdown: invalidMarkdown, versionFacts: versions });
  assert.ok(invalid.failures.some((failure) => failure.includes("non-empty English")));
  assert.ok(invalid.failures.some((failure) => failure.includes("duplicate CHANGELOG version")));
  assert.ok(invalid.failures.some((failure) => failure.includes("strictly descending")));
});

test("rejects a stale first entry and invalid calendar date", () => {
  const stale = validateReleaseChangelog({
    markdown: validMarkdown.replace("2026年8月28日（v0.1.3）", "2026年2月30日（v0.1.2）"),
    versionFacts: versions,
  });
  assert.ok(stale.failures.some((failure) => failure.includes("invalid date")));
  assert.ok(stale.failures.some((failure) => failure.includes("first CHANGELOG version")));
});
