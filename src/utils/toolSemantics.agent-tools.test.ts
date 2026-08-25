import { describe, expect, it } from "vitest";
import {
  isBashTool,
  isEditTool,
  isReadTool,
  isSearchTool,
  isWebTool,
} from "./toolSemantics";
import { classifyToolCategory } from "@/features/messages";

describe("agent multi-cli tool polish names", () => {
  it("classifies Grok/Kimi/OpenCode read variants", () => {
    for (const name of ["Read", "read_file", "list_dir", "LS", "view_file"]) {
      expect(isReadTool(name)).toBe(true);
      expect(
        classifyToolCategory({ toolType: "mcpToolCall", title: name }),
      ).toBe("read");
    }
  });

  it("classifies edit/write/delete/multiedit variants", () => {
    for (const name of [
      "Write",
      "write_file",
      "Edit",
      "MultiEdit",
      "search_replace",
      "str_replace",
      "apply_patch",
      "Delete",
      "delete_file",
    ]) {
      expect(isEditTool(name)).toBe(true);
      expect(
        classifyToolCategory({ toolType: "mcpToolCall", title: name }),
      ).toBe("edit");
    }
    expect(
      classifyToolCategory({ toolType: "fileChange", title: "write_file" }),
    ).toBe("fileChange");
  });

  it("classifies bash variants that should stay off polished canvas", () => {
    for (const name of [
      "Bash",
      "run_terminal_command",
      "Shell",
      "exec_command",
    ]) {
      expect(isBashTool(name)).toBe(true);
      expect(
        classifyToolCategory({ toolType: "mcpToolCall", title: name }),
      ).toBe("bash");
    }
  });

  it("classifies search and web without swallowing editors", () => {
    expect(isSearchTool("Grep")).toBe(true);
    expect(isSearchTool("Glob")).toBe(true);
    expect(isSearchTool("codebase_search")).toBe(true);
    expect(isSearchTool("search_replace")).toBe(false);
    expect(isWebTool("WebFetch")).toBe(true);
    expect(isWebTool("web_search")).toBe(true);
  });
});
