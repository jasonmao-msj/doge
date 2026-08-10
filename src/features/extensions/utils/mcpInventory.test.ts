import { describe, expect, it } from "vitest";

import type { GlobalMcpServerEntry } from "../../../services/tauri";

import {
  buildEngineRows,
  filterMcpRows,
  parseCodexMcpServers,
  splitRowsByKind,
} from "./mcpInventory";

const globalServers: GlobalMcpServerEntry[] = [
  {
    name: "filesystem",
    enabled: true,
    transport: "stdio",
    command: "npx",
    url: null,
    argsCount: 2,
    source: "claude_json",
  },
  {
    name: "github",
    enabled: false,
    transport: "stdio",
    command: "uvx",
    url: null,
    argsCount: 3,
    source: "doge_config",
  },
];

describe("parseCodexMcpServers", () => {
  it("parses result.data and strips tool prefixes case-insensitively", () => {
    const rows = parseCodexMcpServers({
      result: {
        data: [
          {
            name: "GitHub",
            authStatus: { status: "connected" },
            tools: {
              mcp__github__search_repos: {},
              mcp__GitHub__create_issue: {},
              unrelated_tool: {},
            },
            resources: [{}],
            resource_templates: [{}, {}],
          },
        ],
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("GitHub");
    expect(rows[0].authLabel).toBe("connected");
    expect(rows[0].toolNames).toEqual(["create_issue", "search_repos", "unrelated_tool"]);
    expect(rows[0].resourcesCount).toBe(1);
    expect(rows[0].templatesCount).toBe(2);
  });

  it("supports string auth, snake/camel template keys, and skips invalid rows", () => {
    const rows = parseCodexMcpServers({
      data: [
        { name: "beta", authStatus: "oauth", tools: {}, resourceTemplates: [{}] },
        { name: " " },
        { tools: {} },
        null,
        { name: "alpha", tools: {} },
      ],
    });

    expect(rows.map((row) => row.name)).toEqual(["alpha", "beta"]);
    expect(rows[1].authLabel).toBe("oauth");
    expect(rows[1].templatesCount).toBe(1);
    expect(rows[0].authLabel).toBeNull();
  });

  it("returns an empty list for garbage payloads", () => {
    expect(parseCodexMcpServers(null)).toEqual([]);
    expect(parseCodexMcpServers({ result: { data: "nope" } })).toEqual([]);
    expect(parseCodexMcpServers([])).toEqual([]);
  });
});

describe("buildEngineRows", () => {
  const codexServers = [
    {
      name: "github",
      authLabel: "connected",
      toolNames: ["search_repos"],
      resourcesCount: 1,
      templatesCount: 2,
    },
  ];
  const claudeRuntimeServers = [
    { name: "doge", status: "connected" },
    { name: "chrome-devtools", status: null },
  ];

  it("builds codex rows from doge config plus runtime inventory", () => {
    const rows = buildEngineRows({
      engine: "codex",
      globalServers,
      codexServers,
      claudeRuntimeServers,
    });

    expect(rows.map((row) => row.id)).toEqual(["config:github", "runtime:github"]);
    const [configRow, runtimeRow] = rows;
    expect(configRow.kind).toBe("config");
    expect(configRow.kind === "config" && configRow.enabled).toBe(false);
    expect(runtimeRow.kind).toBe("runtime");
    expect(runtimeRow.kind === "runtime" && runtimeRow.toolNames).toEqual(["search_repos"]);
    expect(runtimeRow.kind === "runtime" && runtimeRow.builtIn).toBe(false);
  });

  it("builds claude rows from claude_json config plus runtime snapshot", () => {
    const rows = buildEngineRows({
      engine: "claude",
      globalServers,
      codexServers,
      claudeRuntimeServers,
    });

    expect(rows.map((row) => row.id)).toEqual([
      "config:filesystem",
      "runtime:doge",
      "runtime:chrome-devtools",
    ]);
    const dogeRow = rows[1];
    expect(dogeRow.kind === "runtime" && dogeRow.builtIn).toBe(true);
    expect(dogeRow.kind === "runtime" && dogeRow.statusLabel).toBe("connected");
  });
});

describe("filterMcpRows / splitRowsByKind", () => {
  const rows = buildEngineRows({
    engine: "codex",
    globalServers,
    codexServers: [
      {
        name: "github",
        authLabel: null,
        toolNames: [],
        resourcesCount: 0,
        templatesCount: 0,
      },
    ],
    claudeRuntimeServers: [],
  });

  it("filters by source kind and name query", () => {
    expect(filterMcpRows(rows, "all", "")).toHaveLength(2);
    expect(filterMcpRows(rows, "config", "").every((row) => row.kind === "config")).toBe(true);
    expect(filterMcpRows(rows, "runtime", "").every((row) => row.kind === "runtime")).toBe(true);
    expect(filterMcpRows(rows, "all", "GIT")).toHaveLength(2);
    expect(filterMcpRows(rows, "all", "missing")).toHaveLength(0);
  });

  it("splits rows back into config/runtime groups", () => {
    const { configRows, runtimeRows } = splitRowsByKind(rows);
    expect(configRows.map((row) => row.name)).toEqual(["github"]);
    expect(runtimeRows.map((row) => row.name)).toEqual(["github"]);
  });
});
