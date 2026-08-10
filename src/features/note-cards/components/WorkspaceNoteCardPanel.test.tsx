/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceNoteCardPanel } from "./WorkspaceNoteCardPanel";
import { noteCardsFacade } from "../services/noteCardsFacade";
import { isWindowsPlatform } from "../../../utils/platform";
import { pickImageFiles } from "../../../services/tauri";
import { confirm } from "@tauri-apps/plugin-dialog";
import { pushErrorToast } from "../../../services/toasts";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "noteCards.storageHint") {
        return `storage:${String(params?.path ?? "")}`;
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("../../../utils/platform", () => ({
  isWindowsPlatform: vi.fn(() => false),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(async () => true),
}));

vi.mock("../../../services/tauri", () => ({
  pickImageFiles: vi.fn(async () => []),
}));

vi.mock("../../../components/common/ImagePreviewOverlay", () => ({
  ImagePreviewOverlay: () => null,
}));

vi.mock("../../../components/common/LocalImage", () => ({
  LocalImage: () => null,
}));

vi.mock("../../../markdown/components/Markdown", () => ({
  Markdown: ({
    value,
    workspaceId,
    codeBlockStyle,
  }: {
    value: string;
    workspaceId?: string | null;
    codeBlockStyle?: string;
  }) => (
    <div
      data-testid="note-card-markdown"
      data-workspace-id={workspaceId ?? ""}
      data-code-block-style={codeBlockStyle ?? ""}
    >
      {value}
    </div>
  ),
}));

vi.mock("../../../components/common/RichTextInput/RichTextInput", () => ({
  RichTextInput: ({
    value,
    onChange,
    footerLeft,
    footerRight,
  }: {
    value: string;
    onChange: (value: string) => void;
    footerLeft?: ReactNode;
    footerRight?: ReactNode;
  }) => (
    <div>
      <textarea
        data-testid="workspace-note-card-rich-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div>{footerLeft}</div>
      <div>{footerRight}</div>
    </div>
  ),
}));

vi.mock("../services/noteCardsFacade", () => ({
  noteCardsFacade: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("WorkspaceNoteCardPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(isWindowsPlatform).mockReturnValue(false);
    vi.mocked(noteCardsFacade.list).mockResolvedValue({
      items: [
        {
          id: "note-1",
          title: "发布清单",
          plainTextExcerpt: "先构建再发布",
          bodyMarkdown: "先构建再发布",
          updatedAt: 1,
          createdAt: 1,
          archived: false,
          imageCount: 0,
          previewAttachments: [],
        },
      ],
      total: 1,
    } as never);
    vi.mocked(noteCardsFacade.get).mockResolvedValue({
      id: "note-1",
      workspaceId: "ws-1",
      workspaceName: "demo",
      workspacePath: "/tmp/demo",
      projectName: "demo",
      title: "发布清单",
      bodyMarkdown: "先构建再发布",
      plainTextExcerpt: "先构建再发布",
      attachments: [],
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
    } as never);
  });

  async function flushListLoad() {
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });
  }

  it("keeps the editor hidden until the new-note action is requested", async () => {
    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
      />,
    );

    await flushListLoad();
    vi.useRealTimers();

    expect(screen.queryByTestId("workspace-note-card-rich-input")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "noteCards.new" }));

    await waitFor(() => {
      expect(
        (screen.getByTestId("workspace-note-card-rich-input") as HTMLTextAreaElement)
          .value,
      ).toBe("");
    });
  });

  it("opens a selected note read-only before explicit editing", async () => {
    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
      />,
    );

    await flushListLoad();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: /发布清单/ }));

    await waitFor(() => {
      expect(screen.getByTestId("note-card-markdown").textContent).toBe(
        "先构建再发布",
      );
    });
    expect(screen.queryByTestId("workspace-note-card-rich-input")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "noteCards.edit" }));
    expect(
      (screen.getByTestId("workspace-note-card-rich-input") as HTMLTextAreaElement)
        .value,
    ).toBe("先构建再发布");
    expect(screen.getByRole("button", { name: /发布清单/ }).getAttribute("aria-pressed")).toBe("true");
    expect(noteCardsFacade.get).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: "note-1",
        workspaceId: "ws-1",
      }),
    );
  });

  it("clears stale draft state when the workspace scope changes", async () => {
    const view = render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
      />,
    );

    await flushListLoad();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: /发布清单/ }));

    await waitFor(() => {
      expect(screen.getByTestId("note-card-markdown").textContent).toBe(
        "先构建再发布",
      );
    });

    view.rerender(
      <WorkspaceNoteCardPanel
        workspaceId={null}
        workspaceName={null}
        workspacePath={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "noteCards.new" }));

    await waitFor(() => {
      expect(
        (screen.getByTestId("workspace-note-card-rich-input") as HTMLTextAreaElement).value,
      ).toBe("");
    });
  });

  it("uses a Windows-style storage hint path on Windows hosts", async () => {
    vi.mocked(isWindowsPlatform).mockReturnValue(true);

    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="C:\\repo\\demo"
      />,
    );

    await flushListLoad();
    vi.useRealTimers();

    expect(screen.getByText("storage:%USERPROFILE%\\.doge\\note_card\\demo\\active | archive")).toBeTruthy();
  });

  it("surfaces picker errors instead of leaving an unhandled rejection", async () => {
    vi.mocked(pickImageFiles).mockRejectedValueOnce(new Error("picker failed"));

    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
      />,
    );

    await flushListLoad();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: "noteCards.new" }));

    await waitFor(() => {
      expect(screen.queryByTestId("workspace-note-card-rich-input")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "noteCards.attachImage" }));

    await waitFor(() => {
      expect(screen.getByText("picker failed")).toBeTruthy();
    });
  });

  it("marks the list container as empty when there are no active notes", async () => {
    vi.mocked(noteCardsFacade.list).mockResolvedValueOnce({
      items: [],
      total: 0,
    } as never);

    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
      />,
    );

    await flushListLoad();
    vi.useRealTimers();

    const emptyState = screen.getByText("noteCards.emptyPool");
    expect(emptyState).not.toBeNull();
    expect(emptyState.closest(".workspace-note-cards-list")?.className).toContain("is-empty");
  });

  it("focuses the requested note in read-only mode when focus signal arrives", async () => {
    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
        focusNoteId="note-1"
        focusRequestKey={3}
      />,
    );

    await flushListLoad();
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByTestId("note-card-markdown").textContent).toBe(
        "先构建再发布",
      );
    });
    expect(screen.queryByTestId("workspace-note-card-rich-input")).toBeNull();
    expect(noteCardsFacade.get).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: "note-1",
        workspaceId: "ws-1",
      }),
    );
  });

  it("sends the current query to the active collection and clears it accessibly", async () => {
    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
      />,
    );

    await flushListLoad();

    fireEvent.change(screen.getByRole("textbox", { name: "noteCards.searchPlaceholder" }), {
      target: { value: "release" },
    });

    await flushListLoad();
    vi.useRealTimers();

    expect(noteCardsFacade.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archived: false,
        query: "release",
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "noteCards.archive" }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "noteCards.archive" }).getAttribute("aria-selected")).toBe("true");
    });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 150)));

    expect(noteCardsFacade.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archived: true,
        query: "release",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "noteCards.clearSearch" }));
    expect(
      (screen.getByRole("textbox", { name: "noteCards.searchPlaceholder" }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("keeps a dirty draft when note navigation is cancelled", async () => {
    vi.mocked(noteCardsFacade.list).mockResolvedValue({
      items: [
        {
          id: "note-1",
          title: "发布清单",
          plainTextExcerpt: "先构建再发布",
          bodyMarkdown: "先构建再发布",
          updatedAt: 1,
          createdAt: 1,
          archived: false,
          imageCount: 0,
          previewAttachments: [],
        },
        {
          id: "note-2",
          title: "验收清单",
          plainTextExcerpt: "执行测试",
          bodyMarkdown: "执行测试",
          updatedAt: 2,
          createdAt: 2,
          archived: false,
          imageCount: 0,
          previewAttachments: [],
        },
      ],
      total: 2,
    } as never);

    render(
      <WorkspaceNoteCardPanel workspaceId="ws-1" workspaceName="demo" workspacePath="/tmp/demo" />,
    );
    await flushListLoad();
    vi.useRealTimers();

    fireEvent.click(screen.getByRole("button", { name: /发布清单/ }));
    await waitFor(() => {
      expect(screen.getByTestId("note-card-markdown").textContent).toBe("先构建再发布");
    });
    fireEvent.click(screen.getByRole("button", { name: "noteCards.edit" }));
    fireEvent.change(screen.getByTestId("workspace-note-card-rich-input"), {
      target: { value: "尚未保存的修改" },
    });
    vi.mocked(confirm).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: /验收清单/ }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect((screen.getByTestId("workspace-note-card-rich-input") as HTMLTextAreaElement).value).toBe("尚未保存的修改");
    expect(screen.getByRole("button", { name: /发布清单/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the selected editor stable when search results omit the note", async () => {
    render(
      <WorkspaceNoteCardPanel workspaceId="ws-1" workspaceName="demo" workspacePath="/tmp/demo" />,
    );
    await flushListLoad();
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: /发布清单/ }));
    await waitFor(() => {
      expect(screen.getByTestId("note-card-markdown").textContent).toBe("先构建再发布");
    });
    vi.mocked(noteCardsFacade.list).mockResolvedValueOnce({ items: [], total: 0 } as never);
    fireEvent.change(screen.getByRole("textbox", { name: "noteCards.searchPlaceholder" }), {
      target: { value: "missing" },
    });

    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 150)));
    expect(screen.getByTestId("note-card-markdown").textContent).toBe("先构建再发布");
  });

  it("saves through Cmd/Ctrl+S and returns to read-only details", async () => {
    vi.mocked(noteCardsFacade.create).mockResolvedValue({
      id: "note-new",
      workspaceId: "ws-1",
      workspaceName: "demo",
      workspacePath: "/tmp/demo",
      projectName: "demo",
      title: "快捷保存",
      bodyMarkdown: "正文",
      plainTextExcerpt: "正文",
      attachments: [],
      createdAt: 2,
      updatedAt: 2,
      archivedAt: null,
    } as never);
    vi.mocked(noteCardsFacade.get).mockResolvedValueOnce({
      id: "note-new",
      workspaceId: "ws-1",
      workspaceName: "demo",
      workspacePath: "/tmp/demo",
      projectName: "demo",
      title: "快捷保存",
      bodyMarkdown: "正文",
      plainTextExcerpt: "正文",
      attachments: [],
      createdAt: 2,
      updatedAt: 2,
      archivedAt: null,
    } as never);
    render(
      <WorkspaceNoteCardPanel workspaceId="ws-1" workspaceName="demo" workspacePath="/tmp/demo" />,
    );
    await flushListLoad();
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "noteCards.new" }));
    await waitFor(() => {
      expect(screen.queryByTestId("workspace-note-card-rich-input")).not.toBeNull();
    });
    fireEvent.change(screen.getByRole("textbox", { name: "noteCards.titlePlaceholder" }), {
      target: { value: "快捷保存" },
    });
    fireEvent.change(screen.getByTestId("workspace-note-card-rich-input"), {
      target: { value: "正文" },
    });
    fireEvent.keyDown(screen.getByTestId("workspace-note-card-rich-input"), { key: "s", metaKey: true });

    await waitFor(() => expect(noteCardsFacade.create).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.queryByTestId("workspace-note-card-rich-input")).toBeNull();
      expect(screen.getByTestId("note-card-markdown").textContent).toBe("正文");
    });
  });

  it("prefills and consumes a source-aware capture request", async () => {
    const onCaptureRequestHandled = vi.fn();
    const onOpenCodeSource = vi.fn();
    vi.useRealTimers();
    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
        captureRequest={{
          requestId: 9,
          draft: {
            title: "demo.ts · L3",
            bodyMarkdown: "```ts\nconst value = 1;\n```",
            source: {
              kind: "codeSelection",
              path: "src/demo.ts",
              startLine: 3,
              endLine: 3,
              language: "typescript",
            },
          },
        }}
        onCaptureRequestHandled={onCaptureRequestHandled}
        onOpenCodeSource={onOpenCodeSource}
      />,
    );

    await waitFor(() => {
      expect(
        (screen.getByRole("textbox", {
          name: "noteCards.titlePlaceholder",
        }) as HTMLInputElement).value,
      ).toBe("demo.ts · L3");
    });
    expect(
      (screen.getByTestId("workspace-note-card-rich-input") as HTMLTextAreaElement)
        .value,
    ).toContain("const value = 1");
    expect(screen.getByText("noteCards.sourceCode · typescript")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /noteCards\.openCodeSource/ }),
    ).toBeNull();
    expect(onCaptureRequestHandled).toHaveBeenCalledWith(9);
  });

  it("consumes a rejected capture request without replaying it", async () => {
    const onCaptureRequestHandled = vi.fn();
    const view = render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
        onCaptureRequestHandled={onCaptureRequestHandled}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "noteCards.new" }));
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.queryByTestId("workspace-note-card-rich-input")).not.toBeNull();
    });
    fireEvent.change(screen.getByTestId("workspace-note-card-rich-input"), {
      target: { value: "keep this draft" },
    });
    vi.mocked(confirm).mockResolvedValueOnce(false);
    const captureRequest = {
      requestId: 11,
      draft: {
        title: "Conversation",
        bodyMarkdown: "captured text",
        source: {
          kind: "conversationSelection" as const,
          threadId: "thread-1",
          itemIds: ["message-1"],
        },
      },
    };

    view.rerender(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
        captureRequest={captureRequest}
        onCaptureRequestHandled={onCaptureRequestHandled}
      />,
    );

    await waitFor(() => expect(onCaptureRequestHandled).toHaveBeenCalledWith(11));
    expect(
      (screen.getByTestId("workspace-note-card-rich-input") as HTMLTextAreaElement)
        .value,
    ).toBe("keep this draft");

    view.rerender(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
        captureRequest={captureRequest}
        onCaptureRequestHandled={onCaptureRequestHandled}
      />,
    );
    expect(onCaptureRequestHandled).toHaveBeenCalledTimes(1);
  });

  it("offers archive undo through the existing toast action contract", async () => {
    vi.mocked(noteCardsFacade.archive).mockResolvedValue(undefined as never);
    vi.mocked(noteCardsFacade.restore).mockResolvedValue({ id: "note-1" } as never);
    render(
      <WorkspaceNoteCardPanel workspaceId="ws-1" workspaceName="demo" workspacePath="/tmp/demo" />,
    );
    await flushListLoad();
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "noteCards.archiveAction" }));

    await waitFor(() => expect(pushErrorToast).toHaveBeenCalled());
    const toast = vi.mocked(pushErrorToast).mock.calls[0]?.[0];
    await act(async () => {
      await toast?.actions?.[0]?.run();
    });
    expect(noteCardsFacade.restore).toHaveBeenCalledWith(expect.objectContaining({ noteId: "note-1" }));
  });

  it("keeps permanent delete behind the accessible overflow menu and confirmation", async () => {
    vi.mocked(noteCardsFacade.delete).mockResolvedValue(undefined as never);
    render(
      <WorkspaceNoteCardPanel workspaceId="ws-1" workspaceName="demo" workspacePath="/tmp/demo" />,
    );
    await flushListLoad();
    vi.useRealTimers();

    fireEvent.pointerDown(screen.getByRole("button", { name: "noteCards.moreActions" }), {
      button: 0,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "noteCards.deleteAction" }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(noteCardsFacade.delete).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: "note-1", workspaceId: "ws-1" }),
    );
  });

  it("hands the persisted selected note to the conversation reference callback", async () => {
    const onReferenceNote = vi.fn();
    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
        onReferenceNote={onReferenceNote}
      />,
    );
    await flushListLoad();
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: /发布清单/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "noteCards.referenceInChat" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "noteCards.referenceInChat" }));
    expect(onReferenceNote).toHaveBeenCalledWith(expect.objectContaining({ id: "note-1" }));
  });

  it("opens a persisted code source and renders its body with the shared code renderer", async () => {
    const onOpenCodeSource = vi.fn();
    vi.mocked(noteCardsFacade.get).mockResolvedValue({
      id: "note-1",
      workspaceId: "ws-1",
      workspaceName: "demo",
      workspacePath: "/tmp/demo",
      projectName: "demo",
      title: "AppUserController.java · L21–L37",
      bodyMarkdown: "```java\nclass AppUserController {}\n```",
      plainTextExcerpt: "class AppUserController {}",
      attachments: [],
      source: {
        kind: "codeSelection",
        path: "src/main/java/AppUserController.java",
        startLine: 21,
        endLine: 37,
        language: "java",
      },
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
    } as never);

    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
        onOpenCodeSource={onOpenCodeSource}
      />,
    );
    await flushListLoad();
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: /发布清单/ }));

    const sourceLink = await screen.findByRole("button", {
      name: /noteCards\.openCodeSource/,
    });
    fireEvent.click(sourceLink);

    expect(onOpenCodeSource).toHaveBeenCalledWith({
      kind: "codeSelection",
      path: "src/main/java/AppUserController.java",
      startLine: 21,
      endLine: 37,
      language: "java",
    });
    expect(screen.getByTestId("note-card-markdown").dataset).toMatchObject({
      workspaceId: "ws-1",
      codeBlockStyle: "message",
    });
  });

  it("keeps conversation source summaries read-only", async () => {
    vi.mocked(noteCardsFacade.get).mockResolvedValue({
      id: "note-1",
      workspaceId: "ws-1",
      workspaceName: "demo",
      workspacePath: "/tmp/demo",
      projectName: "demo",
      title: "Conversation note",
      bodyMarkdown: "Semantic body",
      plainTextExcerpt: "Semantic body",
      attachments: [],
      source: {
        kind: "conversationThread",
        threadId: "thread-1",
        itemCount: 3,
        capturedAt: 1,
      },
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
    } as never);

    render(
      <WorkspaceNoteCardPanel
        workspaceId="ws-1"
        workspaceName="demo"
        workspacePath="/tmp/demo"
        onOpenCodeSource={vi.fn()}
      />,
    );
    await flushListLoad();
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: /发布清单/ }));

    await screen.findByText(/noteCards\.sourceConversationThread/);
    expect(
      screen.queryByRole("button", { name: /noteCards\.openCodeSource/ }),
    ).toBeNull();
  });
});
