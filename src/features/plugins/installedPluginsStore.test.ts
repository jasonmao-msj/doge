import { describe, expect, it } from "vitest";
import { matchViewerPlugin } from "./installedPluginsStore";
import type { InstalledPlugin } from "./types";

function buildPlugin(overrides: {
  id: string;
  filePattern?: string;
  action?: string;
}): InstalledPlugin {
  return {
    installPath: `/tmp/plugins/${overrides.id}`,
    skillLinked: false,
    manifest: {
      manifestVersion: 1,
      id: overrides.id,
      name: overrides.id,
      version: "1.0.0",
      description: "test",
      keywords: [],
      capabilities: overrides.filePattern
        ? {
            viewer: {
              filePattern: overrides.filePattern,
              action: (overrides.action ?? "html-preview") as "html-preview",
            },
          }
        : {},
    },
  };
}

describe("matchViewerPlugin", () => {
  const gzh = buildPlugin({ id: "gzh-design", filePattern: "**/*.gzh.html" });

  it("matches suffix patterns against nested paths", () => {
    expect(matchViewerPlugin([gzh], "gzh-out/attention.gzh.html")).toBe(gzh);
    expect(matchViewerPlugin([gzh], "attention.gzh.html")).toBe(gzh);
    expect(matchViewerPlugin([gzh], "a\\b\\attention.gzh.html")).toBe(gzh);
  });

  it("rejects non-matching files", () => {
    expect(matchViewerPlugin([gzh], "notes/README.md")).toBeNull();
    expect(matchViewerPlugin([gzh], "page.html")).toBeNull();
  });

  it("matches exact file names", () => {
    const exact = buildPlugin({ id: "exact", filePattern: "report.html" });
    expect(matchViewerPlugin([exact], "out/report.html")).toBe(exact);
    expect(matchViewerPlugin([exact], "out/other.html")).toBeNull();
  });

  it("ignores plugins without a viewer capability", () => {
    const skillOnly = buildPlugin({ id: "skill-only" });
    expect(matchViewerPlugin([skillOnly], "attention.gzh.html")).toBeNull();
  });

  it("returns null for empty plugin lists without work", () => {
    expect(matchViewerPlugin([], "attention.gzh.html")).toBeNull();
  });
});
