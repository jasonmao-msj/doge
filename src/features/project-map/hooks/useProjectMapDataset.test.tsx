// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceInfo } from "../../../types";
import { projectMemoryList } from "../../../services/tauri/projectMemory";
import { deriveProjectMapStorageKey } from "../utils/storageKey";
import type { ProjectMapDataset } from "../types";
import {
  createEmptyProjectMapDataset,
  readProjectMapDataset,
  writeProjectMapDataset,
} from "../services/projectMapPersistence";
import {
  runProjectMapGenerationWorker,
  type ProjectMapRunUpdate,
} from "../services/projectMapGenerationWorker";
import {
  __resetProjectMapWorkerClaimsForTests,
  useProjectMapDataset,
} from "./useProjectMapDataset";
import {
  datasetWithAutoIngestion,
  datasetWithPromptNodes,
  datasetWithUnassignedDiscovery,
  emptyReadResponse,
  projectMemory,
  reviewCandidate,
  strictModeWrapper,
  workspace,
} from "./useProjectMapDataset.testSupport";

vi.mock("../services/projectMapPersistence", async () => {
  const actual = await vi.importActual<typeof import("../services/projectMapPersistence")>(
    "../services/projectMapPersistence",
  );
  return {
    ...actual,
    readProjectMapDataset: vi.fn(),
    writeProjectMapDataset: vi.fn(),
  };
});

vi.mock("../services/projectMapGenerationWorker", () => ({
  runProjectMapGenerationWorker: vi.fn(async ({ dataset }) => dataset),
}));

vi.mock("../../../services/tauri/projectMemory", () => ({
  projectMemoryList: vi.fn(async () => ({ items: [], total: 0 })),
}));

describe("useProjectMapDataset", () => {
  beforeEach(() => {
    __resetProjectMapWorkerClaimsForTests();
    vi.mocked(readProjectMapDataset).mockReset();
    vi.mocked(writeProjectMapDataset).mockReset();
    vi.mocked(runProjectMapGenerationWorker).mockReset();
    vi.mocked(runProjectMapGenerationWorker).mockImplementation(async ({ dataset }) => dataset);
    vi.mocked(projectMemoryList).mockReset();
    vi.mocked(projectMemoryList).mockResolvedValue({ items: [], total: 0 });
  });

  it("keeps disabled surfaces lightweight without storage reads or background scans", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });

    const { result } = renderHook(() =>
      useProjectMapDataset(spring, { enabled: false }),
    );

    expect(result.current.status).toBe("empty");
    expect(result.current.dataset.manifest.storageKey).toBe(springKey);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readProjectMapDataset).not.toHaveBeenCalled();
    expect(projectMemoryList).not.toHaveBeenCalled();
    expect(runProjectMapGenerationWorker).not.toHaveBeenCalled();
  });

  it("keeps the disabled cold-start empty dataset reference stable on reload", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });

    const { result } = renderHook(() =>
      useProjectMapDataset(spring, { enabled: false }),
    );
    const coldStartDataset = result.current.dataset;

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.status).toBe("empty");
    expect(result.current.dataset).toBe(coldStartDataset);
    expect(readProjectMapDataset).not.toHaveBeenCalled();
    expect(projectMemoryList).not.toHaveBeenCalled();
    expect(runProjectMapGenerationWorker).not.toHaveBeenCalled();
  });

  it("loads the dataset when a previously disabled surface becomes active", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(
        springKey,
        `/repo/springboot-demo/.doge/project-map/${springKey}`,
      ),
    });

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useProjectMapDataset(spring, { enabled }),
      { initialProps: { enabled: false } },
    );

    expect(result.current.status).toBe("empty");
    expect(readProjectMapDataset).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => {
      expect(readProjectMapDataset).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: spring.id,
          storageMode: "global",
        }),
      );
    });
    await waitFor(() => {
      expect(result.current.status).toBe("empty");
      expect(result.current.storageDir).toBe(
        `/repo/springboot-demo/.doge/project-map/${springKey}`,
      );
    });
  });

  it("clears the previous workspace storage key and ignores stale reads", async () => {
    const mossx = workspace({ id: "ws-mossx", name: "mossx", path: "/repo/mossx" });
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const mossxKey = deriveProjectMapStorageKey({
      projectName: mossx.name,
      workspacePath: mossx.path,
      workspaceId: mossx.id,
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const springResponse = {
      dataset: null,
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    };
    let resolveMossxRead: (value: Awaited<ReturnType<typeof readProjectMapDataset>>) => void =
      () => {};

    vi.mocked(readProjectMapDataset).mockImplementation(({ storageMode, workspaceId }) => {
      if (workspaceId === "ws-mossx") {
        return new Promise((resolve) => {
          resolveMossxRead = (value) => resolve(value);
        });
      }
      if (storageMode === "project" || storageMode === "global") {
        return Promise.resolve(springResponse);
      }
      return Promise.resolve(springResponse);
    });

    const { result, rerender } = renderHook(
      ({ activeWorkspace }: { activeWorkspace: WorkspaceInfo }) =>
        useProjectMapDataset(activeWorkspace),
      { initialProps: { activeWorkspace: mossx } },
    );

    expect(result.current.dataset.manifest.storageKey).toBe(mossxKey);

    rerender({ activeWorkspace: spring });

    await waitFor(() => {
      expect(result.current.dataset.manifest.storageKey).toBe(springKey);
      expect(result.current.status).toBe("empty");
    });

    await act(async () => {
      resolveMossxRead({
        dataset: null,
        response: emptyReadResponse(mossxKey, `/repo/mossx/.doge/project-map/${mossxKey}`),
      });
    });

    expect(result.current.dataset.manifest.storageKey).toBe(springKey);
    expect(result.current.storageDir).toBe(`/repo/springboot-demo/.doge/project-map/${springKey}`);
  });

  it("defaults new requests to global storage even when project path dataset exists", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
    });

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("empty"));

    expect(result.current.activeReadLocation).toBe("global");
    expect(readProjectMapDataset).toHaveBeenCalledWith(
      expect.objectContaining({ storageMode: "global" }),
    );

    act(() => {
      result.current.openGlobalCollection();
    });

    expect(result.current.pendingRequest).toMatchObject({
      storageLocation: "global",
      writePath: `/home/user/.doge/project-map/${springKey}`,
    });
  });

  it("uses the current app engine and model for a new empty project-map collection", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
    });

    const { result } = renderHook(() =>
      useProjectMapDataset(spring, {
        generationDefaults: {
          engine: "claude",
          model: "mimo-v2.5-pro[1M]",
        },
        preferredLanguage: "zh",
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("empty"));

    act(() => {
      result.current.openGlobalCollection();
    });

    expect(result.current.pendingRequest).toMatchObject({
      engine: "claude",
      model: "mimo-v2.5-pro[1M]",
      generationIntent: "global",
      preferredLanguage: "zh",
      storageLocation: "global",
      writePath: `/home/user/.doge/project-map/${springKey}`,
    });
  });

  it("persists auto ingestion interval setting updates", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const baseDataset = datasetWithPromptNodes({ workspace: spring, storageKey: springKey });
    const persistedDataset: ProjectMapDataset = {
      ...baseDataset,
      autoIngestionSettings: {
        ...baseDataset.autoIngestionSettings,
        enabled: false,
        checkIntervalMinutes: 5,
      },
    };
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: persistedDataset,
      response: {
        ...emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
        exists: true,
      },
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    await act(async () => {
      await result.current.updateDataset((current) => ({
        ...current,
        autoIngestionSettings: {
          ...current.autoIngestionSettings,
          checkIntervalMinutes: 17,
        },
      }));
    });

    expect(writeProjectMapDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: expect.objectContaining({
          autoIngestionSettings: expect.objectContaining({
            checkIntervalMinutes: 17,
          }),
        }),
      }),
    );
  });

  it("creates action-specific node requests from the selected node instead of global evidence", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const baseDataset = datasetWithPromptNodes({ workspace: spring, storageKey: springKey });
    const artifactWithoutLabel = JSON.parse(
      '{"type":"file","path":"vite.config.ts","line":"7"}',
    ) as ProjectMapDataset["nodes"][number]["detail"]["relatedArtifacts"][number];
    const legacyStringArtifact = JSON.parse(
      '"org.springframework.cloud:spring-cloud-starter-gateway"',
    ) as ProjectMapDataset["nodes"][number]["detail"]["relatedArtifacts"][number];
    const dataset: ProjectMapDataset = {
      ...baseDataset,
      nodes: baseDataset.nodes.map((node) =>
        node.id === "runtime-node"
          ? {
              ...node,
              detail: {
                ...node.detail,
                relatedArtifacts: [
                  artifactWithoutLabel,
                  legacyStringArtifact,
                  { type: "symbol", label: "src/types.ts" },
                ],
              },
            }
          : node,
      ),
    };
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset,
      response: {
        ...emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
        exists: true,
      },
    });

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    const runtimeNode = dataset.nodes.find((node) => node.id === "runtime-node");
    expect(runtimeNode).toBeTruthy();

    act(() => {
      result.current.openNodeGeneration("node", runtimeNode!);
    });

    expect(result.current.pendingRequest).toMatchObject({
      kind: "node",
      generationIntent: "completeNode",
      scope: { kind: "node", nodeId: "runtime-node", includeDescendants: true },
    });
    expect(result.current.pendingRequest?.readSources.map((source) => source.path)).toEqual([
      "package.json",
      "vite.config.ts",
      undefined,
      "src/types.ts",
    ]);
    expect(
      result.current.pendingRequest?.readSources.find((source) => source.path === "vite.config.ts"),
    ).toMatchObject({
      label: "vite.config.ts",
      line: 7,
    });
    expect(
      result.current.pendingRequest?.readSources.find((source) =>
        source.label.includes("spring-cloud-starter-gateway"),
      ),
    ).toMatchObject({
      type: "symbol",
      label: "org.springframework.cloud:spring-cloud-starter-gateway",
    });
    expect(
      result.current.pendingRequest?.readSources.find((source) => source.path === "src/types.ts"),
    ).toMatchObject({
      type: "symbol",
      label: "src/types.ts",
    });

    act(() => {
      result.current.openNodeGeneration("calibrate", runtimeNode!);
    });

    expect(result.current.pendingRequest).toMatchObject({
      kind: "node",
      generationIntent: "calibrateNode",
      scope: { kind: "node", nodeId: "runtime-node", includeDescendants: false },
    });
    expect(result.current.pendingRequest?.readSources.map((source) => source.path)).not.toContain(
      "src/unrelated.ts",
    );
  });

  it("keeps AI organizer confirmation open when a disabled Gemini request is injected", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const dataset = datasetWithUnassignedDiscovery({ workspace: spring, storageKey: springKey });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset,
      response: {
        ...emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
        exists: true,
      },
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);
    vi.mocked(runProjectMapGenerationWorker).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() =>
      useProjectMapDataset(spring, {
        generationDefaults: {
          engine: "claude",
          model: "claude-sonnet",
        },
        preferredLanguage: "zh",
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    act(() => {
      result.current.openUnassignedOrganizer();
    });

    expect(result.current.pendingRequest).toMatchObject({
      generationIntent: "organizeUnassigned",
      engine: "claude",
      model: "claude-sonnet",
      scope: { kind: "organizer", unassignedCount: 1 },
    });
    expect(result.current.dataset.runs).toEqual([]);

    await act(async () => {
      await result.current.confirmGenerationRequest({
        ...result.current.pendingRequest!,
        engine: "gemini",
        model: "gemini-2.5-pro",
      });
    });

    expect(writeProjectMapDataset).not.toHaveBeenCalled();
    expect(runProjectMapGenerationWorker).not.toHaveBeenCalled();
    expect(result.current.dataset.runs).toEqual([]);
    expect(result.current.error).toBe("unsupported_engine");
    expect(result.current.pendingRequest).not.toBeNull();
  });

  it("confirms a pending candidate through the evidence gate and persists the patched dataset", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const dataset = {
      ...datasetWithPromptNodes({ workspace: spring, storageKey: springKey }),
      candidates: [reviewCandidate()],
      evidenceRecords: [],
    };
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset,
      response: {
        ...emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
        exists: true,
      },
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    await act(async () => {
      await result.current.confirmCandidate("candidate-runtime");
    });

    expect(result.current.error).toBeNull();
    expect(result.current.dataset.nodes.find((node) => node.id === "runtime-node")).toMatchObject({
      summary: "Confirmed runtime facts",
      confidence: "medium",
      candidate: false,
    });
    expect(result.current.dataset.candidates?.[0]).toMatchObject({ status: "confirmed" });
    expect(result.current.dataset.evidenceRecords).toHaveLength(1);
    expect(writeProjectMapDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: expect.objectContaining({
          candidates: [expect.objectContaining({ status: "confirmed" })],
        }),
      }),
    );
  });

  it("confirms all pending review and standalone node candidates with one persistence write", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const baseDataset = datasetWithPromptNodes({ workspace: spring, storageKey: springKey });
    const dataset = {
      ...baseDataset,
      nodes: baseDataset.nodes.map((node) =>
        node.id === "unrelated-node" ? { ...node, candidate: true } : node,
      ),
      candidates: [reviewCandidate()],
      evidenceRecords: [],
    };
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset,
      response: {
        ...emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
        exists: true,
      },
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    await act(async () => {
      const batchResult = await result.current.confirmAllCandidates();
      expect(batchResult).toMatchObject({ confirmed: 2, skipped: 0, errors: [] });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.dataset.candidates?.[0]).toMatchObject({ status: "confirmed" });
    expect(result.current.dataset.nodes.find((node) => node.id === "runtime-node")).toMatchObject({
      summary: "Confirmed runtime facts",
      candidate: false,
    });
    expect(result.current.dataset.nodes.find((node) => node.id === "unrelated-node")?.candidate).toBe(false);
    expect(writeProjectMapDataset).toHaveBeenCalledTimes(1);
  });

  it("confirms staged parent-move candidates in parent-before-child order", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const baseDataset = datasetWithPromptNodes({ workspace: spring, storageKey: springKey });
    const generatedBy = {
      engine: "codex",
      model: "gpt-5.3-codex-spark",
      runId: "seed",
    };
    const unassignedParent = {
      ...baseDataset.nodes[0]!,
      id: "unassigned-discoveries",
      nodeKind: "cross-cutting",
      title: "Unassigned Discoveries",
      parentId: "project-core",
      children: ["frontend-application-layer", "messages-module"],
      generatedBy,
    };
    const appNode = {
      ...baseDataset.nodes[0]!,
      id: "frontend-application-layer",
      nodeKind: "module",
      title: "Frontend Application Layer",
      summary: "React frontend app module that owns user-facing features.",
      parentId: "unassigned-discoveries",
      children: ["messages-module"],
      generatedBy,
    };
    const featureNode = {
      ...baseDataset.nodes[0]!,
      id: "messages-module",
      nodeKind: "module",
      title: "Messages Rendering Module",
      summary: "Feature module for chat messages.",
      parentId: "unassigned-discoveries",
      children: [],
      generatedBy,
    };
    const dataset = {
      ...baseDataset,
      nodes: [
        ...baseDataset.nodes.map((node) => ({ ...node, candidate: false })),
        unassignedParent,
        appNode,
        featureNode,
      ],
      candidates: [
        reviewCandidate({
          id: "move-feature-first",
          source: "organizer",
          kind: "parentMove",
          targetNodeId: "messages-module",
          patch: { nodeId: "messages-module" },
          move: {
            nodeId: "messages-module",
            fromParentId: "unassigned-discoveries",
            suggestedParentId: "frontend-application-layer",
            confidence: "medium",
            reason: "Feature belongs under app.",
          },
          evidence: [],
        }),
        reviewCandidate({
          id: "move-app-second",
          source: "organizer",
          kind: "parentMove",
          targetNodeId: "frontend-application-layer",
          patch: { nodeId: "frontend-application-layer" },
          move: {
            nodeId: "frontend-application-layer",
            fromParentId: "unassigned-discoveries",
            suggestedParentId: "project-core",
            confidence: "high",
            reason: "App is top-level structure.",
          },
          evidence: [],
        }),
      ],
      evidenceRecords: [],
    };
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset,
      response: {
        ...emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
        exists: true,
      },
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    await act(async () => {
      const batchResult = await result.current.confirmAllCandidates();
      expect(batchResult).toEqual({ confirmed: 2, skipped: 0, errors: [] });
    });

    expect(result.current.dataset.nodes.find((node) => node.id === "frontend-application-layer")?.parentId).toBe(
      "project-core",
    );
    expect(result.current.dataset.nodes.find((node) => node.id === "messages-module")?.parentId).toBe(
      "frontend-application-layer",
    );
    expect(result.current.dataset.nodes.find((node) => node.id === "unassigned-discoveries")?.children).not.toContain(
      "messages-module",
    );
  });

  it("does not report batch confirmation success when persistence fails", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const dataset = {
      ...datasetWithPromptNodes({ workspace: spring, storageKey: springKey }),
      candidates: [reviewCandidate()],
      evidenceRecords: [],
    };
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset,
      response: {
        ...emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
        exists: true,
      },
    });
    vi.mocked(writeProjectMapDataset).mockRejectedValue(new Error("disk is read-only"));

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    await act(async () => {
      const batchResult = await result.current.confirmAllCandidates();
      expect(batchResult).toEqual({
        confirmed: 0,
        skipped: 1,
        errors: ["disk is read-only"],
      });
    });

    expect(result.current.error).toBe("disk is read-only");
    expect(result.current.dataset.candidates?.[0]).toMatchObject({ status: "pending" });
    expect(result.current.dataset.nodes.find((node) => node.id === "runtime-node")).toMatchObject({
      summary: "Runtime facts",
      candidate: true,
    });
  });

  it("keeps the active node unchanged and shows an error when candidate confirmation fails", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const dataset = {
      ...datasetWithPromptNodes({ workspace: spring, storageKey: springKey }),
      candidates: [
        reviewCandidate({
          patch: {
            nodeId: "runtime-node",
            confidence: "high",
            sources: [],
          },
        }),
      ],
    };
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset,
      response: {
        ...emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
        exists: true,
      },
    });

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    await act(async () => {
      await result.current.confirmCandidate("candidate-runtime");
    });

    expect(result.current.error).toContain(
      "Confirmed project-map node claims require at least one source.",
    );
    expect(result.current.dataset.nodes.find((node) => node.id === "runtime-node")?.summary).toBe(
      "Runtime facts",
    );
    expect(result.current.dataset.candidates?.[0]).toMatchObject({ status: "pending" });
    expect(writeProjectMapDataset).not.toHaveBeenCalled();
  });

  it("rejects a pending candidate without changing the active node", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const dataset = {
      ...datasetWithPromptNodes({ workspace: spring, storageKey: springKey }),
      candidates: [reviewCandidate()],
      viewState: {
        layoutPreset: "radial" as const,
        nodeLayouts: {
          "project-core": { x: 1200, y: 800, pinned: true },
          "runtime-node": { x: 900, y: 500, pinned: true },
        },
        updatedAt: "2026-05-26T01:00:00.000Z",
      },
    };
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset,
      response: {
        ...emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
        exists: true,
      },
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    await act(async () => {
      await result.current.rejectCandidate("candidate-runtime");
    });

    expect(result.current.dataset.candidates?.[0]).toMatchObject({ status: "rejected" });
    expect(result.current.dataset.nodes.find((node) => node.id === "runtime-node")?.summary).toBe(
      "Runtime facts",
    );
  });

  it("deletes a non-root node through manual pruning and persists the dataset", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const dataset = {
      ...datasetWithPromptNodes({ workspace: spring, storageKey: springKey }),
      candidates: [reviewCandidate()],
      viewState: {
        layoutPreset: "radial" as const,
        nodeLayouts: {
          "project-core": { x: 1200, y: 800, pinned: true },
          "runtime-node": { x: 900, y: 500, pinned: true },
        },
        updatedAt: "2026-05-26T01:00:00.000Z",
      },
    };
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset,
      response: {
        ...emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
        exists: true,
      },
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    await act(async () => {
      await result.current.deleteNode("runtime-node");
    });

    expect(result.current.dataset.nodes.some((node) => node.id === "runtime-node")).toBe(false);
    expect(result.current.dataset.nodes.find((node) => node.id === "project-core")?.children).not.toContain(
      "runtime-node",
    );
    expect(result.current.dataset.viewState?.nodeLayouts).toEqual({
      "project-core": { x: 1200, y: 800, pinned: true },
    });
    expect(result.current.dataset.candidates?.[0]).toMatchObject({ status: "rejected" });
    expect(writeProjectMapDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: expect.objectContaining({
          nodes: expect.not.arrayContaining([expect.objectContaining({ id: "runtime-node" })]),
          viewState: expect.objectContaining({
            nodeLayouts: {
              "project-core": { x: 1200, y: 800, pinned: true },
            },
          }),
        }),
      }),
    );
  });

  it("physically deletes the root node subtree through manual pruning", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const dataset = datasetWithPromptNodes({ workspace: spring, storageKey: springKey });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset,
      response: {
        ...emptyReadResponse(springKey, `/home/user/.doge/project-map/${springKey}`),
        exists: true,
      },
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    await act(async () => {
      await result.current.deleteNode("project-core");
    });

    expect(result.current.dataset.nodes).toHaveLength(0);
    expect(result.current.dataset.manifest.lensStats.every((stats) => stats.nodeCount === 0)).toBe(true);
    expect(writeProjectMapDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: expect.objectContaining({
          nodes: [],
        }),
      }),
    );
  });

  it("switches the panel read location without changing the global write default", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const globalDir = `/home/user/.doge/project-map/${springKey}`;
    const projectDir = `/repo/springboot-demo/.doge/project-map/${springKey}`;

    vi.mocked(readProjectMapDataset).mockImplementation(({ storageMode }) =>
      Promise.resolve({
        dataset: null,
        response: emptyReadResponse(springKey, storageMode === "project" ? projectDir : globalDir),
      }),
    );

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => {
      expect(result.current.status).toBe("empty");
      expect(result.current.activeReadLocation).toBe("global");
      expect(result.current.storageDir).toBe(globalDir);
    });

    act(() => {
      result.current.switchReadLocation("project");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("empty");
      expect(result.current.activeReadLocation).toBe("project");
      expect(result.current.storageDir).toBe(projectDir);
    });
    expect(readProjectMapDataset).toHaveBeenLastCalledWith(
      expect.objectContaining({ storageMode: "project" }),
    );

    act(() => {
      result.current.openGlobalCollection();
    });

    expect(result.current.pendingRequest).toMatchObject({
      storageLocation: "global",
      writePath: globalDir,
    });
  });

  it("does not switch the panel read location after confirming a project-local write", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const globalDir = `/home/user/.doge/project-map/${springKey}`;
    const projectDir = `/repo/springboot-demo/.doge/project-map/${springKey}`;
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(springKey, globalDir),
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("empty"));

    act(() => {
      result.current.openGlobalCollection();
    });

    const request = result.current.pendingRequest;
    expect(request).not.toBeNull();

    await act(async () => {
      await result.current.confirmGenerationRequest({
        ...request!,
        storageLocation: "project",
        writePath: projectDir,
      });
    });

    expect(writeProjectMapDataset).toHaveBeenCalledWith(
      expect.objectContaining({ storageLocation: "project" }),
    );
    expect(result.current.activeReadLocation).toBe("global");
  });

  it("keeps persisted project data isolated from the default global read location", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const globalDir = `/home/user/.doge/project-map/${springKey}`;
    const projectDir = `/repo/springboot-demo/.doge/project-map/${springKey}`;
    const projectDataset = createEmptyProjectMapDataset({
      identity: {
        projectName: spring.name,
        workspacePath: spring.path,
        workspaceId: spring.id,
      },
      storageKey: springKey,
    });

    vi.mocked(readProjectMapDataset).mockImplementation(({ storageMode }) =>
      Promise.resolve({
        dataset: storageMode === "project" ? projectDataset : null,
        response: {
          ...emptyReadResponse(springKey, storageMode === "project" ? projectDir : globalDir),
          exists: storageMode === "project",
        },
      }),
    );

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => {
      expect(result.current.status).toBe("empty");
      expect(result.current.activeReadLocation).toBe("global");
      expect(result.current.storageDir).toBe(globalDir);
    });

    act(() => {
      result.current.switchReadLocation("project");
    });

    await waitFor(() => {
      expect(result.current.status).toBe("persisted");
      expect(result.current.activeReadLocation).toBe("project");
      expect(result.current.storageDir).toBe(projectDir);
    });
  });

  it("normalizes Windows-style project paths and still defaults to global write location", async () => {
    const spring = workspace({
      id: "ws-spring-win",
      name: "springboot-demo",
      path: "C:\\repo\\springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(
        springKey,
        `C:\\repo\\springboot-demo\\.doge\\project-map\\${springKey}`,
      ),
    });

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("empty"));

    act(() => {
      result.current.openGlobalCollection();
    });

    expect(result.current.pendingRequest).toMatchObject({
      storageLocation: "global",
      writePath: `.doge/project-map/${springKey}`,
    });
  });

  it("keeps a confirmed generation request visible until the queued run is persisted", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    });
    vi.mocked(writeProjectMapDataset).mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("empty"));

    act(() => {
      result.current.openGlobalCollection();
    });

    const request = result.current.pendingRequest;
    expect(request).not.toBeNull();

    act(() => {
      void result.current.confirmGenerationRequest({
        ...request!,
        engine: "codex",
        model: "gpt-5.3-codex-spark",
      });
    });

    expect(result.current.pendingRequest).toMatchObject({ id: request!.id });
    expect(result.current.dataset.runs).toEqual([]);
    expect(writeProjectMapDataset).toHaveBeenCalledTimes(1);
    expect(runProjectMapGenerationWorker).not.toHaveBeenCalled();
  });

  it("keeps the pending request when the initial queued run cannot be persisted", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    });
    vi.mocked(writeProjectMapDataset).mockRejectedValueOnce(new Error("write failed"));

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("empty"));

    act(() => {
      result.current.openGlobalCollection();
    });

    const request = result.current.pendingRequest;
    expect(request).not.toBeNull();

    act(() => {
      void result.current.confirmGenerationRequest(request!);
    });

    await waitFor(() => {
      expect(result.current.pendingRequest).toMatchObject({ id: request!.id });
      expect(result.current.error).toBe("write failed");
    });
    expect(result.current.dataset.runs).toEqual([]);
    expect(runProjectMapGenerationWorker).not.toHaveBeenCalled();
  });

  it("queues a real auto ingestion generation run when project memory reaches threshold", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: datasetWithAutoIngestion({
        workspace: spring,
        storageKey: springKey,
        engine: "claude",
        model: "claude-sonnet-4-5",
      }),
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    });
    vi.mocked(projectMemoryList).mockResolvedValue({
      items: [projectMemory()],
      total: 1,
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);
    vi.mocked(runProjectMapGenerationWorker).mockImplementation(() => new Promise(() => {}));

    renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(projectMemoryList).toHaveBeenCalledWith({ workspaceId: spring.id, pageSize: 50 }));
    await waitFor(() => {
      expect(writeProjectMapDataset).toHaveBeenCalledWith(
        expect.objectContaining({
          dataset: expect.objectContaining({
            runs: expect.arrayContaining([
              expect.objectContaining({
                kind: "auto",
                status: "pending",
                engine: "claude",
                model: "claude-sonnet-4-5",
                requestScope: { kind: "auto", messageHashes: [expect.any(String)] },
                generationIntent: "autoIngestion",
                autoIngestion: expect.objectContaining({
                  applyMode: "createCandidate",
                  consumedMessages: [expect.objectContaining({ sessionId: "session-1" })],
                  memoryEvidence: [expect.objectContaining({ memoryId: "memory-1" })],
                }),
              }),
            ]),
            memoryCursor: expect.objectContaining({
              pendingMessages: [expect.objectContaining({ sessionId: "session-1" })],
            }),
          }),
        }),
      );
    });
  });

  it("does not scan project memory before the auto ingestion interval elapses", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: datasetWithAutoIngestion({
        workspace: spring,
        storageKey: springKey,
        interval: 1440,
        lastCheckedAt: new Date().toISOString(),
      }),
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    });

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));
    expect(projectMemoryList).not.toHaveBeenCalled();
  });

  it("marks auto ingestion memory processed only after successful worker completion", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: datasetWithAutoIngestion({ workspace: spring, storageKey: springKey }),
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    });
    vi.mocked(projectMemoryList).mockResolvedValue({
      items: [projectMemory()],
      total: 1,
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(runProjectMapGenerationWorker).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(result.current.dataset.memoryCursor.processedMessages).toHaveLength(1);
      expect(result.current.dataset.memoryCursor.pendingMessages).toHaveLength(0);
      expect(result.current.dataset.runs[0]).toMatchObject({ kind: "auto", status: "completed" });
    });
  });

  it("keeps auto ingestion memory unprocessed when the worker fails", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: datasetWithAutoIngestion({ workspace: spring, storageKey: springKey }),
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    });
    vi.mocked(projectMemoryList).mockResolvedValue({
      items: [projectMemory()],
      total: 1,
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);
    vi.mocked(runProjectMapGenerationWorker).mockRejectedValueOnce(new Error("auto failed"));

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(runProjectMapGenerationWorker).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(result.current.dataset.memoryCursor.processedMessages).toHaveLength(0);
      expect(result.current.dataset.memoryCursor.pendingMessages).toHaveLength(1);
      expect(result.current.dataset.runs[0]).toMatchObject({
        kind: "auto",
        status: "failed",
        error: "auto failed",
      });
    });
  });

  it("marks a generation run failed when the worker cannot persist its claimed slot", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    });
    vi.mocked(writeProjectMapDataset)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("claim failed"))
      .mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("empty"));

    act(() => {
      result.current.openGlobalCollection();
    });

    const request = result.current.pendingRequest;
    expect(request).not.toBeNull();

    await act(async () => {
      await result.current.confirmGenerationRequest(request!);
    });

    await waitFor(() => {
      expect(result.current.pendingRequest).toBeNull();
      expect(result.current.error).toBe("claim failed");
      expect(result.current.dataset.runs[0]).toMatchObject({
        id: request!.id,
        status: "failed",
        error: "claim failed",
      });
    });
  });

  it("claims a queued generation run under StrictMode and completes it", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectMapDataset(spring), {
      wrapper: strictModeWrapper,
    });

    await waitFor(() => expect(result.current.status).toBe("empty"));

    act(() => {
      result.current.openGlobalCollection();
    });

    const request = result.current.pendingRequest;
    expect(request).not.toBeNull();

    await act(async () => {
      await result.current.confirmGenerationRequest({
        ...request!,
        engine: "codex",
        model: "gpt-5.3-codex-spark",
      });
    });

    await waitFor(() => {
      expect(runProjectMapGenerationWorker).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.dataset.runs[0]).toMatchObject({
        id: request!.id,
        status: "completed",
        phase: "completed",
      });
    });
    expect(writeProjectMapDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: expect.objectContaining({
          runs: expect.arrayContaining([
            expect.objectContaining({
              id: request!.id,
              status: "running",
              phase: "preparingSources",
            }),
          ]),
        }),
      }),
    );
  });

  it("keeps in-flight worker updates bound to their original workspace after switching projects", async () => {
    const mossx = workspace({ id: "ws-mossx", name: "mossx", path: "/repo/mossx" });
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const mossxKey = deriveProjectMapStorageKey({
      projectName: mossx.name,
      workspacePath: mossx.path,
      workspaceId: mossx.id,
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockImplementation(({ workspaceId }) => {
      if (workspaceId === mossx.id) {
        return Promise.resolve({
          dataset: null,
          response: emptyReadResponse(mossxKey, `/repo/mossx/.doge/project-map/${mossxKey}`),
        });
      }
      return Promise.resolve({
        dataset: null,
        response: emptyReadResponse(
          springKey,
          `/repo/springboot-demo/.doge/project-map/${springKey}`,
        ),
      });
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);
    let capturedRunUpdate: ((update: ProjectMapRunUpdate) => Promise<void>) | null = null;
    let resolveWorker: ((dataset: ProjectMapDataset) => void) | null = null;
    vi.mocked(runProjectMapGenerationWorker).mockImplementation(
      ({ onRunUpdate }) =>
        new Promise((resolve) => {
          capturedRunUpdate = onRunUpdate;
          resolveWorker = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ activeWorkspace }: { activeWorkspace: WorkspaceInfo }) =>
        useProjectMapDataset(activeWorkspace),
      { initialProps: { activeWorkspace: mossx } },
    );

    await waitFor(() => expect(result.current.status).toBe("empty"));

    act(() => {
      result.current.openGlobalCollection();
    });

    const request = result.current.pendingRequest;
    expect(request).not.toBeNull();

    await act(async () => {
      await result.current.confirmGenerationRequest(request!);
    });

    await waitFor(() => expect(runProjectMapGenerationWorker).toHaveBeenCalledTimes(1));

    rerender({ activeWorkspace: spring });

    await waitFor(() => {
      expect(result.current.dataset.manifest.storageKey).toBe(springKey);
      expect(result.current.status).toBe("empty");
    });

    await act(async () => {
      await capturedRunUpdate?.({
        phase: "askingAi",
        progress: 40,
        log: "Still collecting mossx evidence.",
      });
    });

    expect(writeProjectMapDataset).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: mossx.id,
        expectedStorageKey: mossxKey,
        dataset: expect.objectContaining({
          manifest: expect.objectContaining({ storageKey: mossxKey }),
        }),
      }),
    );
    expect(result.current.dataset.manifest.storageKey).toBe(springKey);

    const runningDataset = vi.mocked(runProjectMapGenerationWorker).mock.calls[0]?.[0].dataset;
    expect(runningDataset).toBeDefined();

    await act(async () => {
      resolveWorker?.({
        ...runningDataset!,
        nodes: [
          ...runningDataset!.nodes,
          {
            id: "mossx-worker-node",
            lensId: "overview",
            nodeKind: "module",
            title: "mossx worker node",
            summary: "Belongs to mossx only",
            detail: {
              coreDescription: "Belongs to mossx only",
              keyFacts: [],
              keyLogic: [],
              riskSignals: [],
              relatedArtifacts: [],
            },
            children: [],
            sources: [{ type: "file", label: "package.json", path: "package.json" }],
            confidence: "medium",
            stale: false,
            candidate: false,
            lastGeneratedAt: "2026-05-26T02:00:00.000Z",
            generatedBy: {
              engine: "codex",
              model: "gpt-5.3-codex-spark",
              runId: request!.id,
            },
          },
        ],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(writeProjectMapDataset).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: mossx.id,
          expectedStorageKey: mossxKey,
          dataset: expect.objectContaining({
            manifest: expect.objectContaining({ storageKey: mossxKey }),
            nodes: expect.arrayContaining([
              expect.objectContaining({ id: "mossx-worker-node" }),
            ]),
          }),
        }),
      );
    });
    expect(result.current.dataset.manifest.storageKey).toBe(springKey);
    expect(result.current.dataset.nodes.some((node) => node.id === "mossx-worker-node")).toBe(false);
  });

  it("does not let an in-flight global worker overwrite the project storage view", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const globalDataset = datasetWithPromptNodes({ workspace: spring, storageKey: springKey });
    const projectDataset: ProjectMapDataset = {
      ...createEmptyProjectMapDataset({
        identity: {
          projectName: spring.name,
          workspacePath: spring.path,
          workspaceId: spring.id,
        },
        storageKey: springKey,
      }),
      nodes: [
        {
          id: "project-storage-node",
          lensId: "overview",
          nodeKind: "module",
          title: "Project storage node",
          summary: "Only visible in project storage",
          detail: {
            coreDescription: "Only visible in project storage",
            keyFacts: [],
            keyLogic: [],
            riskSignals: [],
            relatedArtifacts: [],
          },
          children: [],
          sources: [{ type: "file", label: "README", path: "README.md" }],
          confidence: "medium",
          stale: false,
          candidate: false,
          lastGeneratedAt: "2026-05-26T02:00:00.000Z",
          generatedBy: {
            engine: "codex",
            model: "gpt-5.3-codex-spark",
            runId: "project-seed",
          },
        },
      ],
    };
    const globalDir = `/home/user/.doge/project-map/${springKey}`;
    const projectDir = `/repo/springboot-demo/.doge/project-map/${springKey}`;
    vi.mocked(readProjectMapDataset).mockImplementation(({ storageMode }) =>
      Promise.resolve({
        dataset: storageMode === "project" ? projectDataset : globalDataset,
        response: {
          ...emptyReadResponse(springKey, storageMode === "project" ? projectDir : globalDir),
          exists: true,
        },
      }),
    );
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);
    let resolveWorker: ((dataset: ProjectMapDataset) => void) | null = null;
    vi.mocked(runProjectMapGenerationWorker).mockImplementation(
      ({ dataset }) =>
        new Promise((resolve) => {
          resolveWorker = resolve;
          void dataset;
        }),
    );

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("persisted"));

    await act(async () => {
      await result.current.updateDataset((current) => ({
        ...current,
        runs: [
          {
            id: "global-active-run",
            kind: "global",
            status: "running",
            phase: "askingAi",
            engine: "codex",
            model: "gpt-5.3-codex-spark",
            startedAt: "2026-05-26T01:55:00.000Z",
            completedAt: null,
            scope: "global",
            storageLocation: "global",
          },
        ],
      }));
    });

    await waitFor(() => expect(runProjectMapGenerationWorker).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.switchReadLocation("project");
    });

    await waitFor(() => {
      expect(result.current.activeReadLocation).toBe("project");
      expect(result.current.dataset.nodes.some((node) => node.id === "project-storage-node")).toBe(true);
    });

    const runningDataset = vi.mocked(runProjectMapGenerationWorker).mock.calls[0]?.[0].dataset;
    expect(runningDataset).toBeDefined();

    await act(async () => {
      resolveWorker?.({
        ...runningDataset!,
        nodes: [
          ...runningDataset!.nodes,
          {
            id: "global-worker-node",
            lensId: "overview",
            nodeKind: "module",
            title: "Global worker node",
            summary: "Only belongs to global storage",
            detail: {
              coreDescription: "Only belongs to global storage",
              keyFacts: [],
              keyLogic: [],
              riskSignals: [],
              relatedArtifacts: [],
            },
            children: [],
            sources: [{ type: "file", label: "package.json", path: "package.json" }],
            confidence: "medium",
            stale: false,
            candidate: false,
            lastGeneratedAt: "2026-05-26T02:00:00.000Z",
            generatedBy: {
              engine: "codex",
              model: "gpt-5.3-codex-spark",
              runId: "global-active-run",
            },
          },
        ],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(writeProjectMapDataset).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: spring.id,
          storageLocation: "global",
          expectedStorageKey: springKey,
          dataset: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({ id: "global-worker-node" }),
            ]),
          }),
        }),
      );
    });
    expect(result.current.activeReadLocation).toBe("project");
    expect(result.current.dataset.nodes.some((node) => node.id === "project-storage-node")).toBe(true);
    expect(result.current.dataset.nodes.some((node) => node.id === "global-worker-node")).toBe(false);
  });

  it("does not duplicate an in-flight generation run after remount", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    const persistedDataset = createEmptyProjectMapDataset({
      identity: {
        projectName: spring.name,
        workspacePath: spring.path,
        workspaceId: spring.id,
      },
      storageKey: springKey,
    });
    const datasetWithRunningRun = {
      ...persistedDataset,
      runs: [
        {
          id: "active-run",
          kind: "global" as const,
          status: "running" as const,
          phase: "askingAi" as const,
          engine: "codex" as const,
          model: "gpt-5.3-codex-spark",
          startedAt: "2026-05-26T01:55:00.000Z",
          completedAt: null,
          scope: "global" as const,
        },
      ],
    };
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: datasetWithRunningRun,
      response: {
        ...emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
        exists: true,
      },
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);
    vi.mocked(runProjectMapGenerationWorker).mockImplementation(() => new Promise(() => {}));

    const firstRender = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(runProjectMapGenerationWorker).toHaveBeenCalledTimes(1));
    firstRender.unmount();

    renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(readProjectMapDataset).toHaveBeenCalledTimes(2));
    expect(runProjectMapGenerationWorker).toHaveBeenCalledTimes(1);
  });

  it("cancels pending runs and clears finished run history", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);
    vi.mocked(runProjectMapGenerationWorker).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("empty"));

    await act(async () => {
      await result.current.updateDataset((current) => ({
        ...current,
        runs: [
          {
            id: "active-run",
            kind: "global",
            status: "running",
            phase: "askingAi",
            engine: "codex",
            model: "gpt-5.3-codex-spark",
            startedAt: "2026-05-26T01:55:00.000Z",
            completedAt: null,
            scope: "global",
          },
          {
            id: "queued-run",
            kind: "global",
            status: "pending",
            engine: "codex",
            model: "gpt-5.3-codex-spark",
            startedAt: "2026-05-26T02:00:00.000Z",
            completedAt: null,
            scope: "global",
          },
          {
            id: "done-run",
            kind: "global",
            status: "completed",
            engine: "codex",
            model: "gpt-5.3-codex-spark",
            startedAt: "2026-05-26T01:00:00.000Z",
            completedAt: "2026-05-26T01:01:00.000Z",
            scope: "global",
          },
        ],
      }));
    });

    await act(async () => {
      await result.current.cancelGenerationRun("queued-run");
    });

    expect(result.current.dataset.runs.find((run) => run.id === "queued-run")).toMatchObject({
      status: "cancelled",
    });

    await act(async () => {
      await result.current.clearFinishedRuns();
    });

    expect(result.current.dataset.runs.map((run) => run.id)).toEqual(["active-run"]);
  });

  it("cancels a running generation run from the active slot", async () => {
    const spring = workspace({
      id: "ws-spring",
      name: "springboot-demo",
      path: "/repo/springboot-demo",
    });
    const springKey = deriveProjectMapStorageKey({
      projectName: spring.name,
      workspacePath: spring.path,
      workspaceId: spring.id,
    });
    vi.mocked(readProjectMapDataset).mockResolvedValue({
      dataset: null,
      response: emptyReadResponse(springKey, `/repo/springboot-demo/.doge/project-map/${springKey}`),
    });
    vi.mocked(writeProjectMapDataset).mockResolvedValue(undefined);
    let resolveWorker: (() => void) | null = null;
    vi.mocked(runProjectMapGenerationWorker).mockImplementation(
      ({ dataset }) =>
        new Promise((resolve) => {
          resolveWorker = () => resolve(dataset);
        }),
    );

    const { result } = renderHook(() => useProjectMapDataset(spring));

    await waitFor(() => expect(result.current.status).toBe("empty"));

    await act(async () => {
      await result.current.updateDataset((current) => ({
        ...current,
        runs: [
          {
            id: "active-run",
            kind: "global",
            status: "running",
            phase: "askingAi",
            engine: "codex",
            model: "gpt-5.3-codex-spark",
            startedAt: "2026-05-26T01:55:00.000Z",
            completedAt: null,
            scope: "global",
          },
        ],
      }));
    });

    await act(async () => {
      await result.current.cancelGenerationRun("active-run");
    });

    expect(result.current.dataset.runs.find((run) => run.id === "active-run")).toMatchObject({
      status: "cancelled",
      phase: "cancelled",
      progress: 100,
    });

    await waitFor(() => expect(runProjectMapGenerationWorker).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveWorker?.();
      await Promise.resolve();
    });

    expect(result.current.dataset.runs.find((run) => run.id === "active-run")).toMatchObject({
      status: "cancelled",
      phase: "cancelled",
    });
  });
});
