import { describe, expect, it } from "vitest";
import {
  decodeFileLink,
  isLinkableFilePath,
  normalizeBareWindowsFilePathLinks,
  recoverLocalFileLinkPath,
  rewriteWindowsAbsoluteMarkdownLinkDestinations,
  toFileLink,
} from "./remarkFileLinks";

describe("isLinkableFilePath", () => {
  it("does not linkify CJK prose that merely contains slashes", () => {
    expect(isLinkableFilePath("/分支/历史回溯")).toBe(false);
    expect(isLinkableFilePath("/分支/历史")).toBe(false);
    expect(isLinkableFilePath("复制/分支/历史")).toBe(false);
  });

  it("still recognizes real ASCII file paths", () => {
    expect(isLinkableFilePath("/Users/test/a.rs")).toBe(true);
    expect(isLinkableFilePath("src/index.ts")).toBe(true);
    expect(isLinkableFilePath("./config/app.json")).toBe(true);
    expect(isLinkableFilePath("C:\\Users\\ISSUSER\\.ccgui\\workspace")).toBe(true);
    expect(isLinkableFilePath("D:\\AI\\AIchat\\突击队\\输出\\My Deck 修订版.pptx")).toBe(true);
    expect(isLinkableFilePath("/Users/test/Desktop/My Folder/report final.pdf")).toBe(true);
  });

  it("recognizes paths with CJK segments as long as one ASCII segment exists", () => {
    expect(isLinkableFilePath("/Users/张三/code/a.ts")).toBe(true);
    expect(isLinkableFilePath("D:\\AI\\AIchat\\突击队")).toBe(true);
  });

  it("does not linkify mixed CJK/ASCII prose without a file extension", () => {
    expect(isLinkableFilePath("/MCP/权限/models")).toBe(false);
    expect(isLinkableFilePath("/MCP/权限/models）")).toBe(false);
    expect(isLinkableFilePath("/供应商/models/接口")).toBe(false);
  });

  it("normalizes bare Windows paths with spaces into internal markdown links", () => {
    const path = "D:\\AI\\AIchat\\突击队\\输出\\My Deck 修订版.pptx";

    expect(normalizeBareWindowsFilePathLinks(`PPTX: ${path}`)).toContain(
      `(codex-file:${encodeURIComponent(path)})`,
    );
  });
});

describe("recoverLocalFileLinkPath", () => {
  const windowsPath = "D:/AI/Alchat/突击队/输出/report.md";

  it("recovers nested rendered Windows links", () => {
    expect(
      recoverLocalFileLinkPath(
        `/[${windowsPath}] (codex-file:${windowsPath})`,
      ),
    ).toBe(windowsPath);
    expect(
      recoverLocalFileLinkPath(
        `[${windowsPath}](codex-file:${encodeURIComponent(windowsPath)})`,
      ),
    ).toBe(windowsPath);
  });

  it("keeps clean paths and decodes encoded file links", () => {
    expect(recoverLocalFileLinkPath("D:/work/a.md")).toBe("D:/work/a.md");
    expect(recoverLocalFileLinkPath("/Users/test/a.md")).toBe("/Users/test/a.md");
    expect(recoverLocalFileLinkPath("src/foo.ts")).toBe("src/foo.ts");
    expect(decodeFileLink(toFileLink("D:/work/a.md"))).toBe("D:/work/a.md");
  });
});

describe("rewriteWindowsAbsoluteMarkdownLinkDestinations", () => {
  it("rewrites drive destinations without touching web or image links", () => {
    const windowsPath = "D:/work/报告.md";
    expect(
      rewriteWindowsAbsoluteMarkdownLinkDestinations(`[报告](${windowsPath})`),
    ).toBe(`[报告](${toFileLink(windowsPath)})`);
    expect(
      rewriteWindowsAbsoluteMarkdownLinkDestinations(
        "[name](https://example.com/a.md)",
      ),
    ).toBe("[name](https://example.com/a.md)");
    expect(
      rewriteWindowsAbsoluteMarkdownLinkDestinations("![img](D:/shots/a.png)"),
    ).toBe("![img](D:/shots/a.png)");
  });
});
