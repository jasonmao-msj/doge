import { describe, expect, it } from "vitest";

import { mockProjectMapData } from "../mockProjectMapData";
import {
  createProjectMapDatasetFixture,
  createProjectMapRelationFixture,
} from "../testUtils/fixtures";
import {
  buildDatasetFromProjectMapRead,
  serializeProjectMapDataset,
  writeProjectMapDataset,
  type ProjectMapReadResponse,
} from "./projectMapPersistence";

function manifestForStorageKey(storageKey: string) {
  return {
    ...mockProjectMapData.manifest,
    storageKey,
  };
}

describe("project map persistence mapper", () => {
  it("serializes manifest, profile, lenses, lens nodes, settings, cursor, candidates, evidence, and runs", () => {
    const files = serializeProjectMapDataset({
      ...mockProjectMapData,
      candidates: [],
      evidenceRecords: [],
      diagramDocuments: [
        {
          id: "auth-service-flow",
          nodeId: "auth-service",
          title: "AuthService Token Flow",
          kind: "sequence",
          summary: "Token issue and refresh flow.",
          sourceRefs: ["src/AuthService.ts"],
          relativePath: "diagrams/auth-service-flow.md",
          path: "/repo/.doge/project-map/mossx-abcd/diagrams/auth-service-flow.md",
          content: "# AuthService Token Flow\n\n```mermaid\nsequenceDiagram\nA->>B: token\n```\n",
          createdAt: "2026-05-26T00:00:00.000Z",
        },
      ],
    });

    expect(files.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "profile.json",
        "lenses/manifest.json",
        "view-state.json",
        "lenses/overview/nodes.json",
        "settings.json",
        "memory-ingestion/cursor.json",
        "memory-ingestion/processed.json",
        "runs/latest.json",
        "candidates/latest.json",
        "evidence/latest.json",
        "diagrams/manifest.json",
        "diagrams/auth-service-flow.md",
      ]),
    );
    expect(files.find((file) => file.relativePath === "diagrams/auth-service-flow.md")?.content)
      .toContain("sequenceDiagram");
  });

  it("serializes unsafe lens ids into platform-safe node file paths", () => {
    const files = serializeProjectMapDataset({
      ...mockProjectMapData,
      lenses: [
        {
          ...mockProjectMapData.lenses[0]!,
          id: "API/Domain",
        },
      ],
      nodes: [
        {
          ...mockProjectMapData.nodes[0]!,
          lensId: "API/Domain",
        },
      ],
    });

    expect(files.map((file) => file.relativePath)).toContain("lenses/api-domain/nodes.json");
    expect(files.map((file) => file.relativePath)).not.toContain("lenses/API/Domain/nodes.json");
  });

  it("prefixes Windows reserved lens ids before writing node files", () => {
    const files = serializeProjectMapDataset({
      ...mockProjectMapData,
      lenses: [
        {
          ...mockProjectMapData.lenses[0]!,
          id: "con.audit",
        },
      ],
      nodes: [
        {
          ...mockProjectMapData.nodes[0]!,
          lensId: "con.audit",
        },
      ],
    });

    expect(files.map((file) => file.relativePath)).toContain("lenses/lens-con.audit/nodes.json");
    expect(files.map((file) => file.relativePath)).not.toContain("lenses/con.audit/nodes.json");
  });

  it("builds a dataset from persisted read payloads and sanitizes settings/cursor", () => {
    const response: ProjectMapReadResponse = {
      storageKey: "mossx-abcd",
      storageDir: "/repo/.doge/project-map/mossx-abcd",
      exists: true,
      manifest: manifestForStorageKey("mossx-abcd"),
      profile: {
        ...mockProjectMapData.profile,
        frameworks: [
          {},
          "Spring Cloud Gateway",
          {
            name: "Nacos",
            confidence: "high",
            evidence: [{ type: "file", label: "pom.xml", path: "pom.xml" }],
          },
        ],
      },
      lenses: { items: mockProjectMapData.lenses },
      lensNodes: {
        overview: { items: mockProjectMapData.nodes.filter((node) => node.lensId === "overview") },
      },
      viewState: {
        layoutPreset: "force",
        nodeLayouts: {
          "project-core": { x: "1200", y: 800, pinned: true, updatedAt: "2026-05-26T00:01:00Z" },
          malformed: { x: "left", y: null, pinned: true },
          "api-surface": { x: 840, y: 520 },
        },
        updatedAt: "2026-05-26T00:02:00Z",
      },
      settings: {
        enabled: true,
        engine: "codex",
        model: "gpt-5.4",
        newSessionThreshold: 0,
        checkIntervalMinutes: 1,
        applyMode: "autoApplyEvidenceBacked",
      },
      cursor: {
        lastCheckedAt: "2026-05-26T00:00:00Z",
        processedMessages: [{ sessionId: "s1", messageHash: "h1" }],
        pendingMessages: [{ sessionId: "s2", messageHash: "h2" }],
      },
      processed: { items: [] },
      candidates: {},
      evidence: {},
      runs: {},
      diagrams: {
        items: [
          {
            id: "auth-service-flow",
            nodeId: "auth-service",
            title: "AuthService Token Flow",
            kind: "sequence",
            summary: "Token issue and refresh flow.",
            sourceRefs: ["src/AuthService.ts"],
            relativePath: "diagrams/auth-service-flow.md",
            path: "/repo/.doge/project-map/mossx-abcd/diagrams/auth-service-flow.md",
            createdAt: "2026-05-26T00:00:00.000Z",
          },
        ],
      },
    };

    const dataset = buildDatasetFromProjectMapRead(response, {
      projectName: "mossx",
      workspacePath: "/repo",
      workspaceId: "ws-1",
    });

    expect(dataset?.autoIngestionSettings.newSessionThreshold).toBe(1);
    expect(dataset?.autoIngestionSettings.checkIntervalMinutes).toBe(5);
    expect(dataset?.memoryCursor.processedMessages).toHaveLength(1);
    expect(dataset?.viewState).toEqual({
      layoutPreset: "force",
      nodeLayouts: {
        "project-core": {
          x: 1200,
          y: 800,
          pinned: true,
          updatedAt: "2026-05-26T00:01:00Z",
        },
        "api-surface": {
          x: 840,
          y: 520,
          pinned: false,
          updatedAt: undefined,
        },
      },
      updatedAt: "2026-05-26T00:02:00Z",
    });
    expect(dataset?.profile.frameworks).toEqual([
      { name: "Spring Cloud Gateway", confidence: "unknown", evidence: [] },
      {
        name: "Nacos",
        confidence: "high",
        evidence: [{ type: "file", label: "pom.xml", path: "pom.xml" }],
      },
    ]);
    expect(dataset?.nodes.length).toBeGreaterThan(0);
    expect(dataset?.diagramDocuments?.[0]).toMatchObject({
      id: "auth-service-flow",
      relativePath: "diagrams/auth-service-flow.md",
    });
  });

  it("quarantines persisted snapshots whose manifest belongs to another storage key", () => {
    const dataset = buildDatasetFromProjectMapRead(
      {
        storageKey: "mossx-abcd",
        storageDir: "/repo/.doge/project-map/mossx-abcd",
        exists: true,
        manifest: manifestForStorageKey("springboot-demo-8e13fe53"),
        profile: mockProjectMapData.profile,
        lenses: { items: mockProjectMapData.lenses },
        lensNodes: {},
        candidates: {},
        evidence: {},
        runs: {},
      },
      { projectName: "mossx", workspacePath: "/repo", workspaceId: "ws-1" },
    );

    expect(dataset).toBeNull();
  });

  it("rejects frontend dataset writes when the expected storage key does not match the manifest", async () => {
    await expect(
      writeProjectMapDataset({
        workspaceId: "ws-mossx",
        dataset: {
          ...mockProjectMapData,
          manifest: manifestForStorageKey("springboot-demo-8e13fe53"),
        },
        expectedStorageKey: "mossx-abcd",
      }),
    ).rejects.toThrow(
      "Project map ownership mismatch: expected mossx-abcd, received springboot-demo-8e13fe53.",
    );
  });

  it("falls back when persisted auto ingestion settings contain non-finite numbers", () => {
    const dataset = buildDatasetFromProjectMapRead(
      {
        storageKey: "mossx-abcd",
        storageDir: "/repo/.doge/project-map/mossx-abcd",
        exists: true,
        manifest: manifestForStorageKey("mossx-abcd"),
        profile: mockProjectMapData.profile,
        lenses: { items: mockProjectMapData.lenses },
        lensNodes: {},
        settings: {
          enabled: true,
          engine: "codex",
          model: "default",
          newSessionThreshold: Number.NaN,
          checkIntervalMinutes: Number.POSITIVE_INFINITY,
          applyMode: "createCandidate",
        },
        candidates: {},
        evidence: {},
        runs: {},
      },
      { projectName: "mossx", workspacePath: "/repo", workspaceId: "ws-1" },
    );

    expect(dataset?.autoIngestionSettings.newSessionThreshold).toBe(5);
    expect(dataset?.autoIngestionSettings.checkIntervalMinutes).toBe(30);
  });

  it("normalizes legacy Gemini auto ingestion settings to a safe default", () => {
    const dataset = buildDatasetFromProjectMapRead(
      {
        storageKey: "mossx-abcd",
        storageDir: "/repo/.doge/project-map/mossx-abcd",
        exists: true,
        manifest: manifestForStorageKey("mossx-abcd"),
        profile: mockProjectMapData.profile,
        lenses: { items: mockProjectMapData.lenses },
        lensNodes: {},
        settings: {
          enabled: true,
          engine: "gemini",
          model: "gemini-2.5-pro",
          newSessionThreshold: 5,
          checkIntervalMinutes: 30,
          applyMode: "createCandidate",
        },
        candidates: {},
        evidence: {},
        runs: {},
      },
      { projectName: "mossx", workspacePath: "/repo", workspaceId: "ws-1" },
    );

    expect(dataset?.autoIngestionSettings).toMatchObject({
      enabled: false,
      engine: "codex",
      model: "default",
    });
  });

  it("loads old snapshots without view-state and ignores malformed layout payloads", () => {
    const oldSnapshot = buildDatasetFromProjectMapRead(
      {
        storageKey: "mossx-abcd",
        storageDir: "/repo/.doge/project-map/mossx-abcd",
        exists: true,
        manifest: manifestForStorageKey("mossx-abcd"),
        profile: mockProjectMapData.profile,
        lenses: { items: mockProjectMapData.lenses },
        lensNodes: {
          overview: { items: mockProjectMapData.nodes.filter((node) => node.lensId === "overview") },
        },
        candidates: {},
        evidence: {},
        runs: {},
      },
      { projectName: "mossx", workspacePath: "/repo", workspaceId: "ws-1" },
    );
    const malformedSnapshot = buildDatasetFromProjectMapRead(
      {
        storageKey: "mossx-abcd",
        storageDir: "/repo/.doge/project-map/mossx-abcd",
        exists: true,
        manifest: manifestForStorageKey("mossx-abcd"),
        profile: mockProjectMapData.profile,
        lenses: { items: mockProjectMapData.lenses },
        lensNodes: {
          overview: { items: mockProjectMapData.nodes.filter((node) => node.lensId === "overview") },
        },
        viewState: {
          layoutPreset: "diagonal",
          nodeLayouts: {
            invalid: { x: Number.NaN, y: 10 },
            valid: { x: 24, y: "48", pinned: "yes" },
          },
        },
        candidates: {},
        evidence: {},
        runs: {},
      },
      { projectName: "mossx", workspacePath: "/repo", workspaceId: "ws-1" },
    );

    expect(oldSnapshot?.viewState).toBeUndefined();
    expect(malformedSnapshot?.viewState).toEqual({
      layoutPreset: "radial",
      nodeLayouts: {
        valid: {
          x: 24,
          y: 48,
          pinned: false,
          updatedAt: undefined,
        },
      },
      updatedAt: undefined,
    });
  });

  it("sanitizes malformed persisted nodes before they reach the UI dataset", () => {
    const dataset = buildDatasetFromProjectMapRead(
      {
        storageKey: "mossx-abcd",
        storageDir: "/repo/.doge/project-map/mossx-abcd",
        exists: true,
        manifest: manifestForStorageKey("mossx-abcd"),
        profile: mockProjectMapData.profile,
        lenses: { items: mockProjectMapData.lenses },
        lensNodes: {
          overview: {
            items: [
              {
                id: "project-core",
                lensId: "overview",
                nodeKind: "",
                title: "Project Core",
                summary: "",
                detail: null,
                children: ["runtime-node", 42, ""],
                sources: [
                  { type: "unexpected", label: String.raw`src\features\project-map\types.ts:7` },
                  { type: "file", label: "absolute", path: String.raw`C:\repo\mossx\secret.ts` },
                  "README.md",
                ],
                confidence: "certain",
                stale: "yes",
                candidate: true,
                generatedBy: {},
              },
              {
                id: "missing-title",
                lensId: "overview",
                summary: "This malformed node should be dropped.",
              },
            ],
          },
        },
        candidates: {},
        evidence: {},
        runs: {},
      },
      { projectName: "mossx", workspacePath: "/repo", workspaceId: "ws-1" },
    );

    const node = dataset?.nodes.find((candidate) => candidate.id === "project-core");

    expect(dataset?.nodes.some((candidate) => candidate.id === "missing-title")).toBe(false);
    expect(node).toMatchObject({
      nodeKind: "concept",
      summary: "Project Core",
      detail: {
        coreDescription: "Project Core",
        keyFacts: [],
        keyLogic: [],
        riskSignals: [],
        relatedArtifacts: [],
      },
      children: [],
      confidence: "unknown",
      stale: false,
      candidate: true,
      generatedBy: {
        engine: "unknown",
        model: "unknown",
        runId: "unknown",
      },
    });
    expect(node?.sources).toEqual([
      {
        type: "file",
        label: String.raw`src\features\project-map\types.ts:7`,
        path: "src/features/project-map/types.ts",
      },
      {
        type: "file",
        label: "absolute",
      },
      {
        type: "file",
        label: "README.md",
        path: "README.md",
      },
    ]);
  });

  it("repairs persisted orphan roots so loaded maps remain reachable from the project root", () => {
    const rootNode = mockProjectMapData.nodes.find((node) => node.id === "project-core")!;
    const orphanNode = {
      ...mockProjectMapData.nodes.find((node) => node.id === "hub-api")!,
      id: "auto-memory-claim",
      title: "Auto Memory Claim",
      nodeKind: "bugfix",
      parentId: undefined,
      children: [],
      candidate: true,
    };
    const dataset = buildDatasetFromProjectMapRead(
      {
        storageKey: "mossx-abcd",
        storageDir: "/repo/.doge/project-map/mossx-abcd",
        exists: true,
        manifest: manifestForStorageKey("mossx-abcd"),
        profile: mockProjectMapData.profile,
        lenses: { items: mockProjectMapData.lenses },
        lensNodes: {
          overview: { items: [rootNode, orphanNode] },
        },
        candidates: {},
        evidence: {},
        runs: {},
      },
      { projectName: "mossx", workspacePath: "/repo", workspaceId: "ws-1" },
    );

    expect(dataset?.nodes.find((node) => node.id === "auto-memory-claim")).toMatchObject({
      parentId: "unassigned-discoveries",
    });
    expect(dataset?.nodes.find((node) => node.id === "project-core")?.children).not.toContain(
      "auto-memory-claim",
    );
    expect(dataset?.nodes.find((node) => node.id === "unassigned-discoveries")?.children).toContain(
      "auto-memory-claim",
    );
  });

  it("deduplicates persisted nodes that appear in multiple lens node files", () => {
    const rootNode = mockProjectMapData.nodes.find((node) => node.id === "project-core")!;
    const moduleHub = mockProjectMapData.nodes.find((node) => node.id === "hub-modules")!;
    const connectedNode = mockProjectMapData.nodes.find((node) => node.id === "module-frontend")!;
    const duplicateLensNode = {
      ...connectedNode,
      lensId: "overview",
      parentId: undefined,
      children: [],
      summary: "Duplicate frontend surface should merge into the connected node.",
      detail: {
        ...connectedNode.detail,
        keyFacts: ["Duplicate lens copy carries extra detail."],
        relatedArtifacts: [
          {
            type: "file" as const,
            label: "duplicate",
            path: "src/features/project-map/duplicate.ts",
          },
        ],
      },
      sources: [
        {
          type: "file" as const,
          label: "duplicate",
          path: "src/features/project-map/duplicate.ts",
        },
      ],
      lastGeneratedAt: "2026-05-27T00:00:00.000Z",
      generatedBy: {
        engine: "claude",
        model: "duplicate",
        runId: "duplicate-run",
      },
    };

    const dataset = buildDatasetFromProjectMapRead(
      {
        storageKey: "mossx-abcd",
        storageDir: "/repo/.doge/project-map/mossx-abcd",
        exists: true,
        manifest: manifestForStorageKey("mossx-abcd"),
        profile: mockProjectMapData.profile,
        lenses: { items: mockProjectMapData.lenses },
        lensNodes: {
          modules: { items: [rootNode, moduleHub, connectedNode] },
          frontend: { items: [duplicateLensNode] },
        },
        candidates: {},
        evidence: {},
        runs: {},
      },
      { projectName: "mossx", workspacePath: "/repo", workspaceId: "ws-1" },
    );

    const frontendNodes = dataset?.nodes.filter((node) => node.id === "module-frontend") ?? [];
    const mergedNode = frontendNodes[0];

    expect(frontendNodes).toHaveLength(1);
    expect(mergedNode).toMatchObject({
      parentId: "hub-modules",
      lastGeneratedAt: "2026-05-27T00:00:00.000Z",
      generatedBy: {
        runId: "duplicate-run",
      },
    });
    expect(mergedNode?.detail.keyFacts).toContain("Duplicate lens copy carries extra detail.");
    expect(mergedNode?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/features/project-map/duplicate.ts" }),
      ]),
    );
    expect(dataset?.nodes.find((node) => node.id === "hub-modules")?.children).toContain(
      "module-frontend",
    );
  });

  it("restores queued runs even before generated lenses exist", () => {
    const dataset = buildDatasetFromProjectMapRead(
      {
        storageKey: "mossx-abcd",
        storageDir: "/repo/.doge/project-map/mossx-abcd",
        exists: true,
        manifest: manifestForStorageKey("mossx-abcd"),
        profile: mockProjectMapData.profile,
        lenses: { items: [] },
        lensNodes: {},
        candidates: {},
        evidence: {},
        runs: {
          latest: {
            items: [
              {
                id: "global_run_1",
                kind: "global",
                status: "pending",
                engine: "codex",
                model: "gpt-5.3-codex-spark",
                startedAt: "2026-05-26T02:40:00.000Z",
                completedAt: null,
                scope: "global",
              },
            ],
          },
        },
      },
      { projectName: "mossx", workspacePath: "/repo", workspaceId: "ws-1" },
    );

    expect(dataset?.lenses).toEqual([]);
    expect(dataset?.runs[0]).toMatchObject({
      id: "global_run_1",
      status: "pending",
    });
  });

  it("rejects future schema versions", () => {
    const dataset = buildDatasetFromProjectMapRead(
      {
        storageKey: "future",
        storageDir: "/repo/.doge/project-map/future",
        exists: true,
        manifest: { ...mockProjectMapData.manifest, schemaVersion: 999 },
        profile: mockProjectMapData.profile,
        lenses: { items: mockProjectMapData.lenses },
        lensNodes: {},
        candidates: {},
        evidence: {},
        runs: {},
      },
      { projectName: "mossx", workspacePath: "/repo", workspaceId: "ws-1" },
    );

    expect(dataset).toBeNull();
  });

  it("roundtrips relation payloads and filters invalid persisted endpoints", () => {
    const fixture = createProjectMapDatasetFixture({
      relations: [
        createProjectMapRelationFixture({
          id: "relation-api-data",
          label: "API depends on data store",
          weight: 2,
        }),
      ],
    });
    const relation = fixture.relations?.[0];
    if (!relation) {
      throw new Error("Expected relation fixture to contain a relation");
    }
    const relationFile = serializeProjectMapDataset(fixture).find(
      (file) => file.relativePath === "relations/latest.json",
    );
    const serializedRelations = JSON.parse(relationFile?.content ?? "{}") as {
      items?: Array<{ id?: string; sourceKind?: string; weight?: number }>;
    };

    const dataset = buildDatasetFromProjectMapRead(
      {
        storageKey: "project-map-fixture",
        storageDir: "workspace/project-map-fixture/.doge/project-map/project-map-fixture",
        exists: true,
        manifest: fixture.manifest,
        profile: fixture.profile,
        lenses: { items: fixture.lenses },
        lensNodes: {
          overview: { items: fixture.nodes },
        },
        candidates: {},
        evidence: {},
        runs: {},
        relations: {
          items: [
            relation,
            {},
            {
              ...relation,
              id: "relation-missing-target",
              targetNodeId: "missing-node",
            },
          ],
        },
      },
      { projectName: "project-map-fixture", workspacePath: "workspace/project-map-fixture", workspaceId: "ws-1" },
    );

    expect(serializedRelations.items?.[0]).toMatchObject({
      id: "relation-api-data",
      sourceKind: "deterministic",
      weight: 2,
    });
    expect(dataset?.relations).toEqual([
      expect.objectContaining({
        id: "relation-api-data",
        label: "API depends on data store",
        weight: 2,
      }),
    ]);
  });

  it("loads legacy snapshots without relation payloads as an empty relation set", () => {
    const fixture = createProjectMapDatasetFixture();
    const dataset = buildDatasetFromProjectMapRead(
      {
        storageKey: "project-map-fixture",
        storageDir: "workspace/project-map-fixture/.doge/project-map/project-map-fixture",
        exists: true,
        manifest: fixture.manifest,
        profile: fixture.profile,
        lenses: { items: fixture.lenses },
        lensNodes: {
          overview: { items: fixture.nodes },
        },
        candidates: {},
        evidence: {},
        runs: {},
      },
      { projectName: "project-map-fixture", workspacePath: "workspace/project-map-fixture", workspaceId: "ws-1" },
    );

    expect(dataset?.relations).toEqual([]);
  });
});
