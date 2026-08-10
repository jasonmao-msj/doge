import { describe, expect, it } from "vitest";
import {
  getDefaultWorkspaceCandidatePaths,
  isDefaultWorkspacePath,
} from "./defaultWorkspace";

describe("defaultWorkspace", () => {
  it("matches doge and legacy ccgui default workspace paths", () => {
    expect(isDefaultWorkspacePath("/Users/chen/.doge/workspace")).toBe(true);
    expect(isDefaultWorkspacePath("/Users/chen/.ccgui/workspace")).toBe(true);
    expect(isDefaultWorkspacePath("/Users/chen/com.zhukunpenglinyutong.ccgui/workspace")).toBe(
      true,
    );
  });

  it("matches mac/unix codemoss default workspace path", () => {
    expect(isDefaultWorkspacePath("/Users/chen/.codemoss/workspace")).toBe(true);
    expect(isDefaultWorkspacePath("/Users/chen/.codemoss/workspace/")).toBe(true);
  });

  it("matches Windows-style path case-insensitively", () => {
    expect(isDefaultWorkspacePath("C:\\Users\\CHEN\\.CodeMoss\\Workspace")).toBe(true);
    expect(isDefaultWorkspacePath("C:\\Users\\CHEN\\.CCGUI\\Workspace")).toBe(true);
  });

  it("does not match lookalike suffixes such as workspace-backup", () => {
    expect(isDefaultWorkspacePath("/Users/chen/.codemoss/workspace-backup")).toBe(
      false,
    );
    expect(isDefaultWorkspacePath("C:\\Users\\chen\\.codemoss\\workspace_temp")).toBe(
      false,
    );
  });

  it("does not match nested child directories under default workspace root", () => {
    expect(isDefaultWorkspacePath("/Users/chen/.codemoss/workspace/project-a")).toBe(
      false,
    );
  });

  it("builds default workspace candidate paths from a normalized home path", () => {
    expect(getDefaultWorkspaceCandidatePaths("/Users/chen/")).toEqual([
      "/Users/chen/.doge/workspace",
      "/Users/chen/.ccgui/workspace",
      "/Users/chen/.mossx/workspace",
      "/Users/chen/.codemoss/workspace",
      "/Users/chen/com.zhukunpenglinyutong.ccgui/workspace",
      "/Users/chen/com.zhukunpenglinyutong.mossx/workspace",
      "/Users/chen/com.zhukunpenglinyutong.codemoss/workspace",
    ]);
  });

  it("returns no candidate paths when home path is unavailable", () => {
    expect(getDefaultWorkspaceCandidatePaths("")).toEqual([]);
  });
});
