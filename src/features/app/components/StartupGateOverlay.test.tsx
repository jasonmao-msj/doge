// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STARTUP_GATE_FORCE_DISMISS_MS,
  STARTUP_GATE_MAX_VISIBLE_MS,
  StartupGateOverlay,
  buildStartupGateDiagnosticDump,
} from "./StartupGateOverlay";
import {
  recordStartupCommandTrace,
  recordStartupMilestone,
  recordStartupTaskTrace,
  resetStartupTraceForTests,
} from "../../startup-orchestration/utils/startupTrace";
import {
  isStartupForceEntered,
  resetStartupForceEnterForTests,
} from "../../startup-orchestration/utils/startupForceEnter";
import {
  clearGlobalRuntimeNotices,
  pushGlobalRuntimeNotice,
} from "../../../services/globalRuntimeNotices";
import { resetStartupGateReadyForTests } from "../../startup-orchestration/utils/startupGateReady";
import { resetFullCatalogAutoRetryForTests } from "../../startup-orchestration/utils/fullCatalogAutoRetry";

const platformMocks = vi.hoisted(() => ({
  enabled: true,
}));

const orchestratorMocks = vi.hoisted(() => ({
  cancelAllTasks: vi.fn(),
}));

vi.mock("../../../utils/platform", () => ({
  isStartupGatePlatform: () => platformMocks.enabled,
  isWindowsPlatform: () => true,
  isMacPlatform: () => false,
}));

vi.mock("../../startup-orchestration/utils/startupOrchestrator", () => ({
  startupOrchestrator: {
    cancelAllTasks: orchestratorMocks.cancelAllTasks,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "runtimeNotice.startupTimeline.operations.i18n.title": "加载语言资源",
        "runtimeNotice.startupTimeline.operations.i18n.description":
          "加载当前语言的界面文案。",
        "runtimeNotice.startupTimeline.operations.workspace-catalog.title":
          "获取工作区",
        "runtimeNotice.startupTimeline.operations.workspace-catalog.description":
          "读取工作区清单、项目名称与路径。",
        "runtimeNotice.startupTimeline.operations.interface-resources.title":
          "挂载客户端界面",
        "runtimeNotice.startupTimeline.operations.interface-resources.description":
          "准备界面资源并挂载客户端外壳。",
        "runtimeNotice.bootstrap.mountShell": "正在挂载客户端界面...",
        "runtimeNotice.startupTimeline.status.started": "进行中",
        "runtimeNotice.startupTimeline.status.completed": "完成",
        "runtimeNotice.startupTimeline.globalProject": "全局",
      })[key] ?? key,
  }),
}));

describe("StartupGateOverlay", () => {
  beforeEach(() => {
    platformMocks.enabled = true;
    orchestratorMocks.cancelAllTasks.mockReset();
    resetStartupTraceForTests();
    resetStartupForceEnterForTests();
    resetStartupGateReadyForTests();
    resetFullCatalogAutoRetryForTests();
    clearGlobalRuntimeNotices();
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    // 先卸载订阅者，再清空全局 notice；避免 teardown 触发组件异步更新。
    cleanup();
    vi.useRealTimers();
    resetStartupTraceForTests();
    resetStartupForceEnterForTests();
    resetStartupGateReadyForTests();
    resetFullCatalogAutoRetryForTests();
    clearGlobalRuntimeNotices();
  });

  it("renders when gate platform is enabled", () => {
    render(<StartupGateOverlay />);
    expect(screen.getByTestId("startup-gate-overlay")).toBeTruthy();
    expect(screen.queryByTestId("startup-gate-force-dismiss")).toBeNull();
    expect(screen.getByTestId("startup-gate-module-panel")).toBeTruthy();
    // 诊断时间轴默认折叠
    expect(screen.queryByTestId("startup-gate-timeline")).toBeNull();
    expect(
      screen.getByTestId("startup-gate-module-panel-toggle").getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("does not render when gate platform is disabled", () => {
    platformMocks.enabled = false;
    render(<StartupGateOverlay />);
    expect(screen.queryByTestId("startup-gate-overlay")).toBeNull();
  });

  it("samples compact startup facts instead of subscribing at event cadence", async () => {
    render(<StartupGateOverlay />);

    act(() => {
      recordStartupTaskTrace({
        type: "task",
        taskId: "bootstrap:i18n",
        phase: "critical",
        traceLabel: "i18n",
        workspaceScope: "global",
        lifecycleState: "started",
        durationMs: null,
        fallbackReason: null,
        cancellationMode: null,
        commandLabel: null,
      });
    });

    expect(screen.getByTestId("startup-gate-elapsed").textContent).toContain(
      "events 0",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(screen.getByTestId("startup-gate-elapsed").textContent).toContain(
      "events 1",
    );
  });

  it("shows force-dismiss after 10 seconds", async () => {
    render(<StartupGateOverlay />);
    expect(screen.queryByTestId("startup-gate-force-dismiss")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STARTUP_GATE_FORCE_DISMISS_MS);
    });

    expect(screen.getByTestId("startup-gate-force-dismiss")).toBeTruthy();
  });

  it("does NOT hide on early active-workspace-ready alone (first-paint)", async () => {
    render(<StartupGateOverlay />);
    await act(async () => {
      recordStartupMilestone("active-workspace-ready");
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByTestId("startup-gate-overlay")).toBeTruthy();
  });

  it("stays visible after startup-gate-ready until force-dismiss is clicked", async () => {
    render(<StartupGateOverlay />);
    await act(async () => {
      recordStartupMilestone("startup-gate-ready");
      await vi.advanceTimersByTimeAsync(STARTUP_GATE_MAX_VISIBLE_MS + 1_000);
    });
    expect(screen.getByTestId("startup-gate-overlay")).toBeTruthy();
    expect(screen.getByTestId("startup-gate-force-dismiss")).toBeTruthy();
    expect(orchestratorMocks.cancelAllTasks).not.toHaveBeenCalled();
  });

  it("renders the semantic startup/runtime timeline when panel expanded", async () => {
    render(<StartupGateOverlay />);

    await act(async () => {
      recordStartupTaskTrace({
        type: "task",
        taskId: "bootstrap:i18n",
        phase: "critical",
        traceLabel: "i18n",
        workspaceScope: "global",
        lifecycleState: "started",
        durationMs: null,
        fallbackReason: null,
        cancellationMode: null,
        commandLabel: null,
      });
      recordStartupTaskTrace({
        type: "task",
        taskId: "bootstrap:i18n",
        phase: "critical",
        traceLabel: "i18n",
        workspaceScope: "global",
        lifecycleState: "completed",
        durationMs: 42,
        fallbackReason: null,
        cancellationMode: null,
        commandLabel: null,
      });
      pushGlobalRuntimeNotice({
        severity: "info",
        category: "bootstrap",
        messageKey: "runtimeNotice.bootstrap.mountShell",
      });
    });

    // 默认折叠：列表与复制按钮均未挂载
    expect(screen.queryByTestId("startup-gate-timeline")).toBeNull();
    expect(screen.queryByTestId("startup-gate-copy-diagnostic")).toBeNull();

    await act(async () => {
      screen.getByTestId("startup-gate-module-panel-toggle").click();
    });

    const timeline = screen.getByTestId("startup-gate-timeline");
    expect(timeline.textContent).toContain("加载语言资源");
    expect(timeline.textContent).toContain("完成");
    expect(timeline.textContent).toContain("挂载客户端界面");
    expect(screen.queryByTestId("startup-gate-trace-list")).toBeNull();
    expect(screen.queryByTestId("startup-gate-notice-list")).toBeNull();

    const i18nNode = screen
      .getAllByTestId("startup-timeline-node")
      .find((node) => node.getAttribute("data-operation") === "i18n");
    expect(i18nNode).toBeTruthy();
    expect(screen.getByTestId("startup-gate-copy-diagnostic")).toBeTruthy();
  });

  it("freezes early diagnostics on expand and refreshes only after reopen", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const view = render(<StartupGateOverlay />);

    try {
      expect(
        screen.getByTestId("startup-gate-overlay").className,
      ).not.toContain("backdrop-blur");

      act(() => {
        recordStartupTaskTrace({
          type: "task",
          taskId: "bootstrap:i18n",
          phase: "critical",
          traceLabel: "i18n",
          workspaceScope: "global",
          lifecycleState: "completed",
          durationMs: 18,
          fallbackReason: null,
          cancellationMode: null,
          commandLabel: null,
        });
      });

      await act(async () => {
        screen.getByTestId("startup-gate-module-panel-toggle").click();
      });
      expect(screen.getByTestId("startup-gate-timeline").textContent).toContain(
        "加载语言资源",
      );

      act(() => {
        recordStartupTaskTrace({
          type: "task",
          taskId: "bootstrap:workspace-list",
          phase: "critical",
          traceLabel: "workspace-list",
          workspaceScope: "global",
          lifecycleState: "started",
          durationMs: null,
          fallbackReason: null,
          cancellationMode: null,
          commandLabel: "list_workspaces",
        });
        pushGlobalRuntimeNotice({
          severity: "info",
          category: "bootstrap",
          messageKey: "runtimeNotice.bootstrap.mountShell",
        });
      });

      expect(screen.getByTestId("startup-gate-timeline").textContent).not.toContain(
        "获取工作区",
      );
      expect(screen.getByTestId("startup-gate-timeline").textContent).not.toContain(
        "挂载客户端界面",
      );
      expect(scrollIntoView).not.toHaveBeenCalled();

      await act(async () => {
        screen.getByTestId("startup-gate-module-panel-toggle").click();
      });
      await act(async () => {
        screen.getByTestId("startup-gate-module-panel-toggle").click();
      });

      const refreshedTimeline = screen.getByTestId("startup-gate-timeline");
      expect(refreshedTimeline.textContent).toContain("获取工作区");
      expect(refreshedTimeline.textContent).toContain("挂载客户端界面");
    } finally {
      view.unmount();
      scrollIntoView.mockRestore();
    }
  });

  it("force-dismiss cancels as stale and marks force-enter", async () => {
    render(<StartupGateOverlay />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STARTUP_GATE_FORCE_DISMISS_MS);
    });
    const button = screen.getByTestId("startup-gate-force-dismiss");
    await act(async () => {
      button.click();
    });
    expect(screen.queryByTestId("startup-gate-overlay")).toBeNull();
    expect(orchestratorMocks.cancelAllTasks).toHaveBeenCalledWith("stale");
    expect(isStartupForceEntered()).toBe(true);
  });

  it("one-click copy dumps command rank + full trace for analysis", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<StartupGateOverlay />);
    await act(async () => {
      recordStartupTaskTrace({
        type: "task",
        taskId: "thread-list:full-catalog:ws-1",
        phase: "active-workspace",
        traceLabel: "thread/list full-catalog hydration",
        workspaceScope: { workspaceId: "ws-1" },
        lifecycleState: "completed",
        durationMs: 5170,
        fallbackReason: null,
        cancellationMode: null,
        commandLabel: "list_threads",
      });
      recordStartupCommandTrace({
        type: "command",
        commandLabel: "list_threads",
        workspaceScope: { workspaceId: "ws-1" },
        durationMs: 6091,
        status: "completed",
      });
      pushGlobalRuntimeNotice({
        severity: "info",
        category: "bootstrap",
        messageKey: "runtimeNotice.bootstrap.ready",
      });
    });

    // 复制按钮在折叠区内，需先展开
    expect(screen.queryByTestId("startup-gate-copy-diagnostic")).toBeNull();
    await act(async () => {
      screen.getByTestId("startup-gate-module-panel-toggle").click();
    });

    act(() => {
      recordStartupCommandTrace({
        type: "command",
        commandLabel: "post_expand_latest",
        workspaceScope: "global",
        durationMs: 123,
        status: "completed",
      });
    });

    const copyButton = screen.getByTestId("startup-gate-copy-diagnostic");
    await act(async () => {
      copyButton.click();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const dump = writeText.mock.calls[0]?.[0] as string;
    expect(dump).toContain("=== doge cold-start diagnostic dump ===");
    expect(dump).toContain("--- command cost rank (IPC, desc) ---");
    expect(dump).toContain("list_threads");
    expect(dump).toContain("6091ms");
    expect(dump).toContain("post_expand_latest");
    expect(dump).toContain("thread/list full-catalog hydration");
    expect(dump).toContain("runtimeNotice.bootstrap.ready");
    expect(screen.getByTestId("startup-gate-copy-diagnostic").textContent).toContain(
      "已复制",
    );
  });

  it("buildStartupGateDiagnosticDump ranks slow commands first", () => {
    const dump = buildStartupGateDiagnosticDump({
      elapsedMs: 19_500,
      milestones: { "shell-ready": {}, "input-ready": {} },
      events: [
        {
          type: "command",
          sequence: 1,
          timestamp: 1,
          commandLabel: "prompts_list",
          workspaceScope: "global",
          durationMs: 31,
          status: "completed",
        },
        {
          type: "command",
          sequence: 2,
          timestamp: 2,
          commandLabel: "list_threads",
          workspaceScope: { workspaceId: "ws-a" },
          durationMs: 6091,
          status: "completed",
        },
        {
          type: "command",
          sequence: 3,
          timestamp: 3,
          commandLabel: "opencode_session_list",
          workspaceScope: { workspaceId: "ws-a" },
          durationMs: 3685,
          status: "completed",
        },
      ],
      notices: [],
      gateReadyReason: null,
      fullCatalogAutoRetryBlocked: [],
    });
    expect(dump).toContain("firstPaintPresent: false");
    expect(dump).toContain("gateReadyReason: null");
    expect(dump).toContain("fullCatalogAutoRetryBlocked: —");
    const rankSection = dump.split("--- task cost rank")[0] ?? dump;
    const listIdx = rankSection.indexOf("list_threads");
    const openIdx = rankSection.indexOf("opencode_session_list");
    const promptIdx = rankSection.indexOf("prompts_list");
    expect(listIdx).toBeGreaterThan(-1);
    expect(openIdx).toBeGreaterThan(listIdx);
    expect(promptIdx).toBeGreaterThan(openIdx);
  });
});
