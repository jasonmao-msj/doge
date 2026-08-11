// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resumeThread } from "../../../services/tauri";
import {
  loadSharedProjection,
  loadSharedSession,
} from "../../shared-session/services/sharedSessions";
import { renderActions } from "./useThreadActions.test-utils";

vi.mock("../../../services/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/tauri")>();
  return {
    ...actual,
    resumeThread: vi.fn(),
  };
});

vi.mock("../../shared-session/services/sharedSessions", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../shared-session/services/sharedSessions")
    >();
  return {
    ...actual,
    loadSharedProjection: vi.fn(),
    loadSharedSession: vi.fn(),
  };
});

describe("useThreadActions Shared history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem("doge.sharedProjection");
  });

  it("accepts a valid empty Shared history without entering Native recovery", async () => {
    vi.mocked(loadSharedSession).mockResolvedValue({
      id: "stable-session-id",
      threadId: "shared:stable-session-id",
      title: "更新后的会话标题",
      selectedEngine: "claude",
      items: [],
    });
    vi.mocked(loadSharedProjection).mockResolvedValue([]);
    const { result, dispatch, loadedThreadsRef } = renderActions({
      useUnifiedHistoryLoader: true,
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace(
        "ws-1",
        "shared:stable-session-id",
      );
    });

    expect(loadSharedSession).toHaveBeenCalledWith(
      "ws-1",
      "shared:stable-session-id",
    );
    expect(loadSharedProjection).toHaveBeenCalledWith(
      "ws-1",
      "shared:stable-session-id",
    );
    expect(loadSharedProjection).toHaveBeenCalledTimes(1);
    expect(resumeThread).not.toHaveBeenCalled();
    expect(loadedThreadsRef.current["shared:stable-session-id"]).toBe(true);
    expect(
      result.current.historyLoadingByThreadId["shared:stable-session-id"],
    ).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadHistoryRestoredAt",
        threadId: "shared:stable-session-id",
      }),
    );
  });

  it("keeps a failed Shared projection retryable without invoking Native resume", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(loadSharedSession).mockResolvedValue({
      id: "retryable-session-id",
      threadId: "shared:retryable-session-id",
      title: "显示标题不会参与恢复",
      selectedEngine: "claude",
      items: [],
    });
    vi.mocked(loadSharedProjection).mockRejectedValue(
      new Error("canonical projection unavailable"),
    );
    const onDebug = vi.fn();
    const { result, loadedThreadsRef } = renderActions({
      useUnifiedHistoryLoader: true,
      onDebug,
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace(
        "ws-1",
        "shared:retryable-session-id",
      );
      await result.current.resumeThreadForWorkspace(
        "ws-1",
        "shared:retryable-session-id",
      );
    });

    expect(loadSharedProjection).toHaveBeenCalledTimes(2);
    expect(resumeThread).not.toHaveBeenCalled();
    expect(loadedThreadsRef.current["shared:retryable-session-id"]).toBe(false);
    expect(
      result.current.historyLoadingByThreadId["shared:retryable-session-id"],
    ).toBeUndefined();
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "thread/shared history loader error",
        payload: expect.objectContaining({
          threadId: "shared:retryable-session-id",
        }),
      }),
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
