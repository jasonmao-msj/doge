import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHANGELOG_HEADING = /^#{3,5}\s+\*\*(.+?)（\s*(v?[^）]+)\s*）\*\*\s*$/u;
const CHINESE_MARKER = /^中文[:：]\s*$/u;
const ENGLISH_MARKER = /^English:\s*$/iu;
const RULE_LINE = /^-{3,}\s*$/u;
const SEMVER = /^\d+\.\d+\.\d+$/u;

function normalizeNewlines(value) {
  return String(value).replace(/\r\n/g, "\n");
}

function trimBlock(lines) {
  const filtered = lines.filter((line) => !RULE_LINE.test(line.trim()));
  let start = 0;
  let end = filtered.length;
  while (start < end && !filtered[start]?.trim()) start += 1;
  while (end > start && !filtered[end - 1]?.trim()) end -= 1;
  return filtered.slice(start, end).join("\n");
}

function sliceLanguageBlock(lines, startIndex, otherIndex) {
  if (startIndex < 0) return [];
  const end = otherIndex > startIndex ? otherIndex : lines.length;
  return lines.slice(startIndex + 1, end);
}

function normalizeVersion(value) {
  return String(value ?? "").trim().replace(/^v/iu, "");
}

function parseEntry(heading, bodyLines) {
  const chineseIndex = bodyLines.findIndex((line) => CHINESE_MARKER.test(line.trim()));
  const englishIndex = bodyLines.findIndex((line) => ENGLISH_MARKER.test(line.trim()));
  return {
    date: heading.date,
    version: heading.version,
    tagName: `v${heading.version}`,
    chineseBody: trimBlock(sliceLanguageBlock(bodyLines, chineseIndex, englishIndex)),
    englishBody: trimBlock(sliceLanguageBlock(bodyLines, englishIndex, chineseIndex)),
    hasChineseMarker: chineseIndex >= 0,
    hasEnglishMarker: englishIndex >= 0,
  };
}

export function parseReleaseChangelog(markdown) {
  const source = normalizeNewlines(markdown);
  const lines = source.split("\n");
  const entries = [];
  let heading = null;
  let bodyLines = [];

  const flush = () => {
    if (!heading) return;
    entries.push(parseEntry(heading, bodyLines));
  };

  for (const line of lines) {
    const match = line.trim().match(CHANGELOG_HEADING);
    if (match) {
      flush();
      heading = {
        date: (match[1] ?? "").trim(),
        version: normalizeVersion(match[2]),
      };
      bodyLines = [];
      continue;
    }
    if (heading) bodyLines.push(line);
  }
  flush();
  return entries;
}

export function compareSemver(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseJson(root, relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function matchVersion(source, pattern, label, failures) {
  const matched = normalizeNewlines(source).match(pattern)?.[1] ?? null;
  if (!matched) failures.push(`${label} version is missing`);
  return matched;
}

export function readReleaseVersionFacts(root) {
  const failures = [];
  const brand = parseJson(root, "config/brand.json");
  const packageJson = parseJson(root, "package.json");
  const packageLock = parseJson(root, "package-lock.json");
  const tauri = parseJson(root, "src-tauri/tauri.conf.json");
  const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  const cargoLock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");

  const facts = {
    brand: brand.version,
    package: packageJson.version,
    packageLock: packageLock.version,
    packageLockRoot: packageLock.packages?.[""]?.version,
    tauri: tauri.version,
    cargo: matchVersion(
      cargoToml,
      /\[package\][\s\S]*?^version = "([^"]+)"/mu,
      "Cargo.toml",
      failures,
    ),
    cargoLock: matchVersion(
      cargoLock,
      /\[\[package\]\]\s*\nname = "doge"\s*\nversion = "([^"]+)"/mu,
      "Cargo.lock",
      failures,
    ),
  };
  return { facts, failures };
}

function isValidChineseDate(value) {
  const matched = value.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/u);
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateReleaseChangelog({ markdown, versionFacts }) {
  const failures = [];
  const entries = parseReleaseChangelog(markdown);
  const facts = Object.entries(versionFacts);
  const canonicalVersion = String(versionFacts.brand ?? "").trim();

  if (!normalizeNewlines(markdown).startsWith("# Changelog\n")) {
    failures.push("CHANGELOG.md must start with '# Changelog'");
  }
  if (!SEMVER.test(canonicalVersion)) {
    failures.push(`canonical brand version is not three-part SemVer: ${canonicalVersion || "<empty>"}`);
  }
  for (const [label, value] of facts) {
    if (value !== canonicalVersion) {
      failures.push(`${label} version ${value ?? "<missing>"} does not match ${canonicalVersion}`);
    }
  }
  if (entries.length === 0) {
    failures.push("CHANGELOG.md has no release entries");
    return { failures, entries, canonicalVersion, currentEntry: null };
  }

  const seen = new Set();
  entries.forEach((entry, index) => {
    if (!SEMVER.test(entry.version)) failures.push(`entry ${index + 1} has invalid version: ${entry.version}`);
    if (!isValidChineseDate(entry.date)) failures.push(`v${entry.version} has invalid date: ${entry.date}`);
    if (!entry.hasChineseMarker || !entry.chineseBody.trim()) {
      failures.push(`v${entry.version} must have a non-empty 中文 section`);
    }
    if (!entry.hasEnglishMarker || !entry.englishBody.trim()) {
      failures.push(`v${entry.version} must have a non-empty English section`);
    }
    if (seen.has(entry.version)) failures.push(`duplicate CHANGELOG version: ${entry.version}`);
    seen.add(entry.version);
    const previous = entries[index - 1];
    if (previous && compareSemver(previous.version, entry.version) <= 0) {
      failures.push(`CHANGELOG versions must be strictly descending: ${previous.version}, ${entry.version}`);
    }
  });

  const currentEntry = entries[0] ?? null;
  if (currentEntry?.version !== canonicalVersion) {
    failures.push(
      `first CHANGELOG version ${currentEntry?.version ?? "<missing>"} does not match ${canonicalVersion}`,
    );
  }
  return { failures, entries, canonicalVersion, currentEntry };
}

export function buildCurrentReleaseNotes(entry) {
  if (!entry) throw new Error("current release entry is required");
  return [
    "## 中文",
    "",
    entry.chineseBody.trim(),
    "",
    "## English",
    "",
    entry.englishBody.trim(),
    "",
  ].join("\n");
}
