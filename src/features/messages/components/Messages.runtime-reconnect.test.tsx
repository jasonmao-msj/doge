// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { ensureRuntimeReady } from "../../../services/tauri";
import { Messages } from "./Messages";
import {
  TRANSIENT_RUNTIME_RECONNECT_AUTO_DISMISS_MS,
  type RuntimeReconnectRecoveryCallbackResult,
} from "../../../runtime-recovery/runtimeReconnect";

vi.mock("../../../services/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/tauri")>();
  return {
    ...actual,
    ensureRuntimeReady: vi.fn(),
  };
});

vi.mock("./Markdown", () => ({
  Markdown: ({
    value,
    onRenderedValueChange,
  }: {
    value: string;
    onRenderedValueChange?: (value: string) => void;
  }) => {
    useEffect(() => {
      onRenderedValueChange?.(value);
    }, [onRenderedValueChange, value]);
    return (
      <div className="markdown">
        {value.split(/\n+/).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    );
  },
}));

describe("Messages runtime reconnect", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });

  beforeEach(() => {
    window.localStorage.setItem("doge.claude.hideReasoningModule", "0");
    window.localStorage.removeItem("doge.messages.live.autoFollow");
    window.localStorage.setItem("doge.messages.live.collapseMiddleSteps", "0");
    vi.mocked(ensureRuntimeReady).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  function renderMessages(items: ConversationItem[], options?: {
    threadId?: string;
    workspaceId?: string | null;
    onRecoverThreadRuntime?: (
      workspaceId: string,
      threadId: string,
    ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
    onRecoverThreadRuntimeAndResend?: (
      workspaceId: string,
      threadId: string,
      message: { text: string; images?: string[] },
    ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
    onThreadRecoveryFork?: () =>
      | Promise<RuntimeReconnectRecoveryCallbackResult>
      | RuntimeReconnectRecoveryCallbackResult;
  }) {
    return render(
      <Messages
        items={items}
        threadId={options?.threadId ?? "thread-runtime-reconnect"}
        workspaceId={
          options && Object.prototype.hasOwnProperty.call(options, "workspaceId")
            ? options.workspaceId
            : "ws-runtime"
        }
        isThinking={false}
        activeEngine="codex"
        onRecoverThreadRuntime={options?.onRecoverThreadRuntime}
        onRecoverThreadRuntimeAndResend={options?.onRecoverThreadRuntimeAndResend}
        onThreadRecoveryFork={options?.onThreadRecoveryFork}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
  }

  it("shows reconnect runtime recovery card for broken pipe errors and triggers ensureRuntimeReady", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntime = vi.fn().mockResolvedValue("thread-runtime-reconnect");

    renderMessages([
      {
        id: "assistant-broken-pipe",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-reconnect",
      onRecoverThreadRuntime,
    });

    expect(screen.getByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "messages.runtimeReconnectAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
      expect(onRecoverThreadRuntime).toHaveBeenCalledWith("ws-runtime", "thread-runtime-reconnect");
      expect(screen.getByText("messages.runtimeReconnectRestored")).toBeTruthy();
      expect(screen.getByText("messages.runtimeReconnectRestoredDetail")).toBeTruthy();
    });
  });

  it("suppresses Native runtime recovery diagnostics for Shared Session threads", () => {
    renderMessages([
      {
        id: "assistant-shared-broken-pipe",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "shared:session-1",
    });

    expect(screen.queryByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeNull();
    expect(screen.queryByText("Broken pipe (os error 32)")).toBeNull();
    expect(screen.queryByText("messages.runtimeReconnectAction")).toBeNull();
  });

  it("shows a recover-specific error when runtime resumes but thread recovery returns null", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntime = vi.fn().mockResolvedValue(null);

    renderMessages([
      {
        id: "assistant-broken-pipe-recover-null",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-reconnect-null",
      onRecoverThreadRuntime,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.runtimeReconnectAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
      expect(onRecoverThreadRuntime).toHaveBeenCalledWith("ws-runtime", "thread-runtime-reconnect-null");
      expect(screen.getByText("messages.runtimeReconnectFailed")).toBeTruthy();
      expect(screen.getByText("messages.runtimeReconnectRecoverFailed")).toBeTruthy();
    });
  });

  it("dedupes repeated runtime reconnect cards and only renders the latest one", () => {
    renderMessages([
      {
        id: "assistant-broken-pipe-1",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
      {
        id: "assistant-broken-pipe-2",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-reconnect-dedupe",
    });

    expect(screen.getAllByRole("group", { name: "messages.runtimeReconnectTitle" })).toHaveLength(1);
  });

  it("keeps compatibility when no thread-level recovery callback is provided", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);

    renderMessages([
      {
        id: "assistant-broken-pipe-compat",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-reconnect-compat",
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.runtimeReconnectAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
    });
  });

  it("shows reconnect runtime recovery card for Windows pipe disconnect errors", () => {
    renderMessages([
      {
        id: "assistant-windows-pipe",
        kind: "message",
        role: "assistant",
        text: "The pipe is being closed. (os error 232)",
      },
    ], {
      threadId: "thread-runtime-reconnect-windows",
    });

    expect(screen.getByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeTruthy();
  });

  it("shows reconnect runtime recovery card for runtime quarantine diagnostics", () => {
    renderMessages([
      {
        id: "assistant-runtime-quarantined",
        kind: "message",
        role: "assistant",
        text:
          "会话启动失败： [RUNTIME_RECOVERY_QUARANTINED] Runtime recovery paused for workspace ws-runtime (engine codex).",
      },
    ], {
      threadId: "thread-runtime-quarantined",
    });

    expect(screen.getByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeTruthy();
    expect(screen.getByText("messages.runtimeReconnectQuarantined")).toBeTruthy();
  });

  it("shows reconnect runtime recovery card for runtime ended diagnostics", () => {
    renderMessages([
      {
        id: "assistant-runtime-ended",
        kind: "message",
        role: "assistant",
        text:
          "[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled.",
      },
    ], {
      threadId: "thread-runtime-ended",
    });

    expect(screen.getByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeTruthy();
    expect(screen.getByText("messages.runtimeReconnectEnded")).toBeTruthy();
  });

  it("keeps the runtime reconnect card when only a user follow-up follows the diagnostic", () => {
    renderMessages([
      {
        id: "assistant-runtime-ended",
        kind: "message",
        role: "assistant",
        text:
          "[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled.",
      },
      {
        id: "user-follow-up",
        kind: "message",
        role: "user",
        text: "继续",
      },
    ], {
      threadId: "thread-runtime-ended-user-follow-up",
    });

    expect(screen.getByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeTruthy();
    expect(screen.getByText("messages.runtimeReconnectEnded")).toBeTruthy();
  });

  it("hides stale runtime reconnect diagnostics after a newer assistant reply", () => {
    renderMessages([
      {
        id: "assistant-runtime-ended",
        kind: "message",
        role: "assistant",
        text:
          "[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled.",
      },
      {
        id: "assistant-after-recovery",
        kind: "message",
        role: "assistant",
        text: "恢复后继续输出。",
      },
    ], {
      threadId: "thread-runtime-ended-after-recovery",
    });

    expect(screen.queryByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeNull();
    expect(screen.queryByRole("group", { name: "messages.runtimeReconnectTransientTitle" })).toBeNull();
    expect(
      screen.queryByText("[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled."),
    ).toBeNull();
    expect(screen.getByText("恢复后继续输出。")).toBeTruthy();
  });

  it("shows transient runtime cleanup diagnostics as lightweight notice without raw details", () => {
    renderMessages([
      {
        id: "assistant-runtime-stale-cleanup",
        kind: "message",
        role: "assistant",
        text:
          "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: stale_reuse_cleanup).",
      },
    ], {
      threadId: "thread-runtime-stale-cleanup",
    });

    const transientCard = screen.getByRole("group", {
      name: "messages.runtimeReconnectTransientTitle",
    });
    expect(transientCard).toBeTruthy();
    expect(transientCard.className).toContain("is-transient");
    expect(screen.getByText("messages.runtimeReconnectTransientCleanup")).toBeTruthy();
    expect(screen.queryByText("messages.runtimeReconnectAction")).toBeNull();
    expect(screen.queryByText("messages.runtimeReconnectResendAction")).toBeNull();
    expect(
      screen.queryByText(
        "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: stale_reuse_cleanup).",
      ),
    ).toBeNull();
    expect(
      screen.queryByRole("group", { name: "messages.runtimeReconnectTitle" }),
    ).toBeNull();
  });

  it("drops transient runtime cleanup diagnostics after the user continues", () => {
    renderMessages([
      {
        id: "assistant-runtime-stale-cleanup",
        kind: "message",
        role: "assistant",
        text:
          "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: stale_reuse_cleanup).",
      },
      {
        id: "user-after-runtime-stale-cleanup",
        kind: "message",
        role: "user",
        text: "继续",
      },
    ], {
      threadId: "thread-runtime-stale-cleanup-user-follow-up",
    });

    expect(
      screen.queryByRole("group", { name: "messages.runtimeReconnectTransientTitle" }),
    ).toBeNull();
    expect(screen.getByText("继续")).toBeTruthy();
    expect(
      screen.queryByText(
        "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: stale_reuse_cleanup).",
      ),
    ).toBeNull();
  });

  it("auto-dismisses transient runtime cleanup diagnostics without showing raw details", async () => {
    vi.useFakeTimers();
    renderMessages([
      {
        id: "assistant-runtime-stale-cleanup",
        kind: "message",
        role: "assistant",
        text:
          "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: stale_reuse_cleanup).",
      },
    ], {
      threadId: "thread-runtime-stale-cleanup-auto-dismiss",
    });

    expect(
      screen.getByRole("group", { name: "messages.runtimeReconnectTransientTitle" }),
    ).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSIENT_RUNTIME_RECONNECT_AUTO_DISMISS_MS + 1);
    });

    expect(
      screen.queryByRole("group", { name: "messages.runtimeReconnectTransientTitle" }),
    ).toBeNull();
    expect(
      screen.queryByText(
        "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: stale_reuse_cleanup).",
      ),
    ).toBeNull();
  });

  it("keeps blocking runtime-ended diagnostics after the transient auto-dismiss window", async () => {
    vi.useFakeTimers();
    renderMessages([
      {
        id: "assistant-runtime-ended",
        kind: "message",
        role: "assistant",
        text:
          "[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled.",
      },
    ], {
      threadId: "thread-runtime-ended-not-transient",
    });

    expect(screen.getByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRANSIENT_RUNTIME_RECONNECT_AUTO_DISMISS_MS + 1);
    });

    expect(screen.getByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeTruthy();
    expect(screen.getByText("messages.runtimeReconnectEnded")).toBeTruthy();
  });

  it("shows only the fork action for stale thread recovery cards", () => {
    const onThreadRecoveryFork = vi.fn();

    renderMessages([
      {
        id: "user-before-thread-not-found",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-thread-not-found",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: 019da207-c1ae-7cb3-9cb6-25f281fbfb30",
      },
    ], {
      threadId: "thread-runtime-stale",
      onThreadRecoveryFork,
    });

    expect(screen.getByRole("group", { name: "messages.threadRecoveryTitle" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "messages.threadRecoveryAction" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "messages.threadRecoveryForkAction" }),
    ).toBeTruthy();
  });

  it("shows a recover-only action for stale thread recovery when a rebind callback exists", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntime = vi.fn().mockResolvedValue("thread-recovered-only");

    renderMessages([
      {
        id: "user-before-thread-recover-only",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-thread-recover-only",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: legacy-thread-id",
      },
    ], {
      threadId: "thread-runtime-stale-recover-only",
      onRecoverThreadRuntime,
    });

    expect(screen.getByRole("button", { name: "messages.threadRecoveryAction" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "messages.threadRecoveryForkAction" }),
    ).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
      expect(onRecoverThreadRuntime).toHaveBeenCalledWith(
        "ws-runtime",
        "thread-runtime-stale-recover-only",
      );
    });
    expect(screen.getByText("messages.threadRecoveryRestored")).toBeTruthy();
    expect(screen.getByText("messages.threadRecoveryRestoredDetail")).toBeTruthy();
  });

  it("routes session-not-found errors to stale thread recovery actions", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntime = vi.fn().mockResolvedValue({
      kind: "failed",
      reason: "no verified replacement thread",
      retryable: true,
      userAction: "recover-thread",
    });

    renderMessages([
      {
        id: "user-before-session-not-found",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-session-not-found",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： [SESSION_NOT_FOUND] session file not found",
      },
    ], {
      threadId: "thread-runtime-stale-session",
      onRecoverThreadRuntime,
    });

    expect(screen.getByRole("group", { name: "messages.threadRecoveryTitle" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryAction" }));

    await waitFor(() => {
      expect(onRecoverThreadRuntime).toHaveBeenCalledWith(
        "ws-runtime",
        "thread-runtime-stale-session",
      );
    });
    expect(screen.getByText("messages.threadRecoveryFailed")).toBeTruthy();
    expect(screen.getByText("messages.threadRecoveryRecoverFailed")).toBeTruthy();
  });

  it("shows fresh fallback guidance when recover-only cannot rebind the stale thread", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntime = vi.fn().mockResolvedValue({
      kind: "fresh",
      threadId: "thread-fresh-only",
    });

    renderMessages([
      {
        id: "user-before-thread-fresh-only",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-thread-fresh-only",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: legacy-thread-id",
      },
    ], {
      threadId: "thread-runtime-stale-fresh-only",
      onRecoverThreadRuntime,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryAction" }));

    await waitFor(() => {
      expect(screen.getByText("messages.threadRecoveryFreshFallbackRequired")).toBeTruthy();
    });
  });

  it("routes stale thread recovery fork through the shared fork callback", async () => {
    const onRecoverThreadRuntime = vi.fn().mockResolvedValue("thread-recovered-resend");
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue("thread-recovered-resend");
    const onThreadRecoveryFork = vi.fn().mockResolvedValue({
      kind: "forked",
      threadId: "thread-forked-1",
    });

    renderMessages([
      {
        id: "user-before-thread-recovery-resend",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-thread-not-found-resend",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: 019da207-c1ae-7cb3-9cb6-25f281fbfb30",
      },
    ], {
      threadId: "thread-runtime-stale-resend",
      onRecoverThreadRuntime,
      onRecoverThreadRuntimeAndResend,
      onThreadRecoveryFork,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryForkAction" }));

    await waitFor(() => {
      expect(onThreadRecoveryFork).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(ensureRuntimeReady)).not.toHaveBeenCalled();
    expect(onRecoverThreadRuntimeAndResend).not.toHaveBeenCalled();
    expect(screen.getByText("messages.threadRecoveryForkedContinued")).toBeTruthy();
  });

  it("surfaces fresh continuation when recovery-card fork falls back", async () => {
    const onThreadRecoveryFork = vi.fn().mockResolvedValue({
      kind: "fresh",
      threadId: "thread-fresh-1",
    });

    renderMessages([
      {
        id: "user-before-fresh-continuation",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-thread-not-found-fresh",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: legacy-thread-id",
      },
    ], {
      threadId: "thread-runtime-stale-fresh-card",
      onThreadRecoveryFork,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryForkAction" }));

    await waitFor(() => {
      expect(onThreadRecoveryFork).toHaveBeenCalledTimes(1);
      expect(screen.getByText("messages.threadRecoveryFreshContinued")).toBeTruthy();
    });
  });

  it("surfaces visible failure when recovery-card fork cannot continue", async () => {
    const onThreadRecoveryFork = vi.fn().mockResolvedValue({
      kind: "failed",
      reason: "fork thread unavailable",
    });

    renderMessages([
      {
        id: "user-before-fork-failed",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-thread-not-found-failed",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: legacy-thread-id",
      },
    ], {
      threadId: "thread-runtime-stale-fork-failed",
      onThreadRecoveryFork,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryForkAction" }));

    await waitFor(() => {
      expect(onThreadRecoveryFork).toHaveBeenCalledTimes(1);
      expect(screen.getByText("messages.threadRecoveryFailed")).toBeTruthy();
      expect(screen.getByText("fork thread unavailable")).toBeTruthy();
    });
  });

  it("does not route stale thread fork through fresh fallback resend", async () => {
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue({
      kind: "fresh",
      threadId: "thread-fresh-resend",
    });
    const onThreadRecoveryFork = vi.fn().mockResolvedValue(undefined);

    renderMessages([
      {
        id: "user-before-thread-fresh-resend",
        kind: "message",
        role: "user",
        text: "继续这句",
      },
      {
        id: "assistant-thread-fresh-resend",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: legacy-thread-id",
      },
    ], {
      threadId: "thread-runtime-stale-fresh-resend",
      onRecoverThreadRuntimeAndResend,
      onThreadRecoveryFork,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryForkAction" }));

    await waitFor(() => {
      expect(onThreadRecoveryFork).toHaveBeenCalledTimes(1);
    });
    expect(onRecoverThreadRuntimeAndResend).not.toHaveBeenCalled();
  });

  it("does not route stale thread fork through forked continuation resend", async () => {
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue({
      kind: "forked",
      threadId: "thread-forked-resend",
    });
    const onThreadRecoveryFork = vi.fn().mockResolvedValue(undefined);

    renderMessages([
      {
        id: "user-before-thread-forked-resend",
        kind: "message",
        role: "user",
        text: "继续这句",
      },
      {
        id: "assistant-thread-forked-resend",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: legacy-thread-id",
      },
    ], {
      threadId: "thread-runtime-stale-forked-resend",
      onRecoverThreadRuntimeAndResend,
      onThreadRecoveryFork,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryForkAction" }));

    await waitFor(() => {
      expect(onThreadRecoveryFork).toHaveBeenCalledTimes(1);
    });
    expect(onRecoverThreadRuntimeAndResend).not.toHaveBeenCalled();
  });

  it("disables stale thread fork when the shared fork callback is unavailable", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue("thread-recovered-resend-only");

    renderMessages([
      {
        id: "user-before-thread-recovery-resend-only",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-thread-not-found-resend-only",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: 019da207-c1ae-7cb3-9cb6-25f281fbfb30",
      },
    ], {
      threadId: "thread-runtime-stale-resend-only",
      onRecoverThreadRuntimeAndResend,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryForkAction" }));

    expect(vi.mocked(ensureRuntimeReady)).not.toHaveBeenCalled();
    expect(onRecoverThreadRuntimeAndResend).not.toHaveBeenCalled();
  });

  it("does not turn a normal assistant reply quoting broken pipe into a reconnect card", () => {
    renderMessages([
      {
        id: "assistant-broken-pipe-quoted",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)\n\n结论先行：这是 stale session，需要重建 runtime。",
      },
    ], {
      threadId: "thread-runtime-reconnect-quoted",
    });

    expect(screen.queryByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeNull();
    expect(
      screen.getByText("结论先行：这是 stale session，需要重建 runtime。"),
    ).toBeTruthy();
  });

  it("shows unavailable hint when the message is not bound to a workspace runtime", () => {
    renderMessages([
      {
        id: "assistant-missing-workspace-runtime",
        kind: "message",
        role: "assistant",
        text: "workspace not connected",
      },
    ], {
      threadId: "thread-runtime-reconnect-unavailable",
      workspaceId: null,
    });

    expect(screen.getByText("messages.runtimeReconnectUnavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "messages.runtimeReconnectAction" }).hasAttribute("disabled")).toBe(true);
  });

  it("reconnects and resends the previous prompt from the latest user message", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue("thread-runtime-resend");

    renderMessages([
      {
        id: "user-before-runtime-resend",
        kind: "message",
        role: "user",
        text: "完事没",
      },
      {
        id: "assistant-broken-pipe-resend",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-resend",
      onRecoverThreadRuntimeAndResend,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.runtimeReconnectResendAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
    });
    expect(onRecoverThreadRuntimeAndResend).toHaveBeenCalledWith(
      "ws-runtime",
      "thread-runtime-resend",
      { text: "完事没", images: undefined },
    );
  });

  it("replays the nearest previous user prompt before the reconnect error", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue("thread-runtime-resend-nearest");

    renderMessages([
      {
        id: "user-before-runtime-resend-nearest",
        kind: "message",
        role: "user",
        text: "真正应该重发的是这句",
      },
      {
        id: "assistant-broken-pipe-resend-nearest",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
      {
        id: "user-after-runtime-resend-nearest",
        kind: "message",
        role: "user",
        text: "这句是后来的，不该被重发",
      },
    ], {
      threadId: "thread-runtime-resend-nearest",
      onRecoverThreadRuntimeAndResend,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.runtimeReconnectResendAction" }));

    await waitFor(() => {
      expect(onRecoverThreadRuntimeAndResend).toHaveBeenCalledWith(
        "ws-runtime",
        "thread-runtime-resend-nearest",
        { text: "真正应该重发的是这句", images: undefined },
      );
    });
  });

  it("disables resend when there is no previous user prompt to replay", () => {
    renderMessages([
      {
        id: "assistant-broken-pipe-resend-unavailable",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-resend-unavailable",
    });

    expect(screen.getByText("messages.runtimeReconnectResendUnavailable")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "messages.runtimeReconnectResendAction" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
