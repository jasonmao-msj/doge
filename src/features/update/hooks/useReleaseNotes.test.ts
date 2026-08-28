import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findReleaseIndex,
  normalizeReleaseVersion,
  parseChangelogEntries,
  type ReleaseNotesEntry,
} from "./useReleaseNotes";

const changelogSampleH5EnglishFirst = `
# Changelog

---

##### **2026年3月3日（v0.2.2）**

English:

✨ Features
- Add release notes modal

中文：

✨ Features
- 新增版本记录弹窗

---

##### **2026年3月2日（v0.2.1）**

English:
- Previous release

中文：
- 上一个版本
`;

/** Matches current repo CHANGELOG: ### headings, 中文 before English. */
const changelogSampleH3ChineseFirst = `
# Changelog

---

### **2026年8月4日（v0.7.16）**

中文：

✨ Features
- Git Graph 工作台更密

English:

✨ Features
- Denser Git Graph workbench

---

### **2026年8月3日（v0.7.15）**

中文：
- 上一版中文

English:
- Previous English
`;

describe("normalizeReleaseVersion", () => {
  it("strips leading v prefix and trims whitespace", () => {
    expect(normalizeReleaseVersion(" v0.2.4 ")).toBe("0.2.4");
    expect(normalizeReleaseVersion("V1.0.0")).toBe("1.0.0");
  });

  it("returns null for empty values", () => {
    expect(normalizeReleaseVersion("")).toBeNull();
    expect(normalizeReleaseVersion("   ")).toBeNull();
    expect(normalizeReleaseVersion(null)).toBeNull();
  });
});

describe("parseChangelogEntries", () => {
  it("extracts bilingual sections from ##### headings (English first)", () => {
    const entries = parseChangelogEntries(changelogSampleH5EnglishFirst);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        tagName: "v0.2.2",
        version: "0.2.2",
        dateLabel: "2026/03/03",
      }),
    );
    expect(entries[0]?.englishBody).toContain("Add release notes modal");
    expect(entries[0]?.chineseBody).toContain("新增版本记录弹窗");
    expect(entries[0]?.englishBody).not.toContain("新增版本记录弹窗");
    expect(entries[0]?.chineseBody).not.toContain("Add release notes modal");
  });

  it("parses ### headings with 中文 section before English", () => {
    const entries = parseChangelogEntries(changelogSampleH3ChineseFirst);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        tagName: "v0.7.16",
        version: "0.7.16",
        dateLabel: "2026/08/04",
      }),
    );
    expect(entries[0]?.chineseBody).toContain("Git Graph 工作台更密");
    expect(entries[0]?.englishBody).toContain("Denser Git Graph workbench");
    expect(entries[0]?.chineseBody).not.toContain("Denser Git Graph workbench");
    expect(entries[0]?.englishBody).not.toContain("Git Graph 工作台更密");
    expect(entries[1]?.version).toBe("0.7.15");
  });

  it("parses the committed release history bundled with the app", () => {
    const changelog = readFileSync(resolve(process.cwd(), "CHANGELOG.md"), "utf8");
    const packageVersion = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ).version as string;
    const entries = parseChangelogEntries(changelog);

    expect(entries[0]?.version).toBe(packageVersion);
    expect(entries.some((entry) => entry.version === "0.1.0")).toBe(true);
    expect(entries.every((entry) => entry.chineseBody.trim().length > 0)).toBe(true);
    expect(entries.every((entry) => entry.englishBody.trim().length > 0)).toBe(true);
  });
});

describe("findReleaseIndex", () => {
  it("matches current version when present", () => {
    const entries: ReleaseNotesEntry[] = [
      {
        id: "0.2.2",
        tagName: "v0.2.2",
        version: "0.2.2",
        title: "v0.2.2",
        dateLabel: "2026/03/03",
        englishBody: "",
        chineseBody: "",
      },
      {
        id: "0.2.1",
        tagName: "v0.2.1",
        version: "0.2.1",
        title: "v0.2.1",
        dateLabel: "2026/03/02",
        englishBody: "",
        chineseBody: "",
      },
    ];

    expect(findReleaseIndex(entries, "0.2.1")).toBe(1);
    expect(findReleaseIndex(entries, "v0.2.2")).toBe(0);
  });

  it("falls back to latest when no match exists", () => {
    const entries: ReleaseNotesEntry[] = [
      {
        id: "0.2.2",
        tagName: "v0.2.2",
        version: "0.2.2",
        title: "v0.2.2",
        dateLabel: "2026/03/03",
        englishBody: "",
        chineseBody: "",
      },
    ];
    expect(findReleaseIndex(entries, "9.9.9")).toBe(0);
    expect(findReleaseIndex(entries, null)).toBe(0);
  });
});
