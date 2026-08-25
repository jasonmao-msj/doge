import { describe, expect, it } from "vitest";
import {
  isCollabLifecycleTool,
  isCollabSpawnTool,
  isSubagentTool,
} from "./isSubagentTool";

describe("isSubagentTool cross-engine", () => {
  it("matches Claude Agent / Task", () => {
    expect(isSubagentTool({ toolType: "agent", title: "Tool: Agent" })).toBe(true);
    expect(isSubagentTool({ toolType: "task", title: "Tool: Task" })).toBe(true);
  });

  it("matches Codex collab spawn but not wait/close", () => {
    expect(
      isSubagentTool({ toolType: "collabToolCall", title: "Collab: spawn Agent" }),
    ).toBe(true);
    expect(isCollabSpawnTool({ toolType: "collabToolCall", title: "Collab: spawn Agent" })).toBe(
      true,
    );
    expect(
      isSubagentTool({ toolType: "collabToolCall", title: "Collab: wait Agent" }),
    ).toBe(false);
    expect(
      isCollabLifecycleTool({ toolType: "collabToolCall", title: "Collab: close Agent" }),
    ).toBe(true);
  });

  it("matches Codex spawn_agent underscore titles (DeepSeek / new protocol)", () => {
    expect(
      isSubagentTool({ toolType: "collabToolCall", title: "Collab: spawn_agent" }),
    ).toBe(true);
    expect(
      isCollabSpawnTool({ toolType: "collabToolCall", title: "Collab: spawn_agent" }),
    ).toBe(true);
    expect(
      isCollabLifecycleTool({ toolType: "collabToolCall", title: "Collab: wait_agent" }),
    ).toBe(true);
    expect(
      isCollabLifecycleTool({ toolType: "collabToolCall", title: "Collab: close_agent" }),
    ).toBe(true);
    expect(
      isSubagentTool({ toolType: "collabToolCall", title: "Collab: wait_agent" }),
    ).toBe(false);
  });

  it("matches Grok Subagent N titles and spawn_subagent", () => {
    expect(
      isSubagentTool({ toolType: "mcpToolCall", title: "Subagent 1 问候测试" }),
    ).toBe(true);
    expect(
      isSubagentTool({ toolType: "tool", title: "Subagent 2 问候测试" }),
    ).toBe(true);
    expect(
      isSubagentTool({ toolType: "spawn_subagent", title: "Spawn Subagent" }),
    ).toBe(true);
    expect(
      isSubagentTool({ toolType: "tool", title: "Spawn Subagent" }),
    ).toBe(true);
  });

  it("rejects Grok subagent output poller", () => {
    expect(
      isSubagentTool({
        toolType: "get_command_or_subagent_output",
        title: "get_command_or_subagent_output",
      }),
    ).toBe(false);
  });

  it("matches Kimi agent swarm titles", () => {
    expect(
      isSubagentTool({
        toolType: "tool",
        title: "Launching agent swarm: 3个子代理问候测试",
      }),
    ).toBe(true);
  });

  it("rejects ordinary tools", () => {
    expect(isSubagentTool({ toolType: "commandExecution", title: "Bash" })).toBe(false);
    expect(isSubagentTool({ toolType: "read", title: "Tool: Read" })).toBe(false);
  });

  it("matches Shared description-as-title Agent payload (no Tool: Agent prefix)", () => {
    expect(
      isSubagentTool({
        toolType: "toolCall",
        title: "问候测试代理1",
        detail: JSON.stringify({
          description: "问候测试代理1",
          subagent_type: "general-purpose",
        }),
      }),
    ).toBe(true);
    expect(
      isSubagentTool({
        toolType: "toolCall",
        title: "Read foo.ts",
        detail: JSON.stringify({ file_path: "foo.ts" }),
      }),
    ).toBe(false);
  });
});
