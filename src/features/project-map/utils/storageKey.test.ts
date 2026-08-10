import { describe, expect, it } from "vitest";

import {
  buildProjectMapRelativePath,
  deriveProjectMapStorageKey,
  hashWorkspaceIdentity,
  isProjectMapRelativePath,
} from "./storageKey";

describe("project map storage key", () => {
  it("includes project name and workspace identity hash to avoid same-name collisions", () => {
    const left = deriveProjectMapStorageKey({
      projectName: "springboot-demo",
      workspacePath: "/Users/demo/a/springboot-demo",
      workspaceId: "ws-a",
    });
    const right = deriveProjectMapStorageKey({
      projectName: "springboot-demo",
      workspacePath: "/Users/demo/b/springboot-demo",
      workspaceId: "ws-b",
    });

    expect(left).toMatch(/^springboot-demo-[a-f0-9]+$/);
    expect(right).toMatch(/^springboot-demo-[a-f0-9]+$/);
    expect(left).not.toBe(right);
  });

  it("normalizes path separators before hashing", () => {
    expect(hashWorkspaceIdentity("C:\\demo\\mossx#ws")).toBe(
      hashWorkspaceIdentity("c:/demo/mossx#ws"),
    );
  });

  it("matches the Rust byte-level FNV hash for non-ASCII workspace paths", () => {
    expect(
      deriveProjectMapStorageKey({
        projectName: "知识库",
        workspacePath: "/Users/chenxiangning/代码/知识库",
        workspaceId: "ws-中文",
      }),
    ).toBe("知识库-8591e4a8");
  });

  it("builds project-map relative paths with platform-neutral separators", () => {
    const path = buildProjectMapRelativePath("mossx-abcd1234", ["lenses", "api", "nodes.json"]);

    expect(path).toBe(".doge/project-map/mossx-abcd1234/lenses/api/nodes.json");
    expect(isProjectMapRelativePath(path, "mossx-abcd1234")).toBe(true);
    expect(isProjectMapRelativePath(".doge/project-map/other/lenses/api/nodes.json", "mossx-abcd1234")).toBe(false);
  });
});
