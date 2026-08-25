import { describe, expect, it } from "vitest";
import { getFileTreeIconSvg } from "./fileTreeIcons";

describe("getFileTreeIconSvg", () => {
  it("uses the same outline folder for every folder and swaps when open", () => {
    const closed = getFileTreeIconSvg("src", true);
    expect(getFileTreeIconSvg("node_modules", true)).toBe(closed);
    expect(getFileTreeIconSvg("src", true, true)).not.toBe(closed);
    expect(closed).toContain("currentColor");
  });

  it("routes by name before extension for git and lock files", () => {
    expect(getFileTreeIconSvg(".gitignore", false)).toContain("#F05133");
    expect(getFileTreeIconSvg(".git", false)).toContain("#F05133");
    expect(getFileTreeIconSvg("flake.lock", false)).toContain("#E3B341");
    expect(getFileTreeIconSvg("pnpm-lock.yaml", false)).toContain("#E3B341");
  });

  it("prefers language extension over eslint name (design: .eslintrc.cjs is a JS badge)", () => {
    expect(getFileTreeIconSvg(".eslintrc.cjs", false)).toContain(">JS<");
    expect(getFileTreeIconSvg(".eslintignore", false)).toContain("#4B32C3");
  });

  it("maps common types and falls back to a plain file", () => {
    expect(getFileTreeIconSvg("app.tsx", false)).toContain(">TS<");
    expect(getFileTreeIconSvg("components.json", false)).toContain("#D9A62E");
    expect(getFileTreeIconSvg("CHANGELOG.md", false)).toContain("#57534E");
    expect(getFileTreeIconSvg("icon.png", false)).toContain("#4CAF50");
    expect(getFileTreeIconSvg("flake.nix", false)).toContain("#7EBAE4");
    expect(getFileTreeIconSvg(".openspec-config", false)).toContain("currentColor");
  });
});
