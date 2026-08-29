import { describe, expect, it } from "vitest";
import {
  normalizeImageLocalPath,
  normalizeImageTags,
  repairFragmentedResourceToken,
  resolveLocalFileHref,
} from "./markdownLocalResources";

describe("markdownLocalResources", () => {
  it("repairs fragmented resource tokens without touching ordinary prose", () => {
    expect(repairFragmentedResourceToken("https: //example.com /docs /guide.md")).toBe(
      "https://example.com/docs/guide.md",
    );
    expect(repairFragmentedResourceToken("这是普通文本")).toBe("这是普通文本");
  });

  it("normalizes local file hrefs from file URLs and absolute paths", () => {
    expect(resolveLocalFileHref("file:///Users/test/spec.md#L12")).toBe(
      "/Users/test/spec.md#L12",
    );
    expect(resolveLocalFileHref("D:\\work\\notes\\todo.md")).toBe(
      "D:\\work\\notes\\todo.md",
    );
    expect(resolveLocalFileHref("https://example.com")).toBeNull();
    expect(
      resolveLocalFileHref(
        "/[D:/AI/Alchat/突击队/输出/report.md] (codex-file:D:/AI/Alchat/突击队/输出/report.md)",
      ),
    ).toBe("D:/AI/Alchat/突击队/输出/report.md");
  });

  it("extracts browser-safe local image paths without converting remote URLs", () => {
    expect(normalizeImageLocalPath("file:///Users/test/image.png")).toBe("/Users/test/image.png");
    expect(normalizeImageLocalPath("D:\\images\\chart.svg")).toBe("D:\\images\\chart.svg");
    expect(normalizeImageLocalPath("https://example.com/image.png")).toBeNull();
  });

  it("rewrites supported image pseudo-tags into standard img tags", () => {
    expect(normalizeImageTags("<image>https://example.com/a.png</image>")).toBe(
      '<img src="https://example.com/a.png" alt="image" loading="lazy" />',
    );
  });
});
