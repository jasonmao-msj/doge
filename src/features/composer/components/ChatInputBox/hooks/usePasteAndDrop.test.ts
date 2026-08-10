/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DETACHED_FILE_TREE_DRAG_BRIDGE_EVENT,
  DETACHED_FILE_TREE_DRAG_SNAPSHOT_STORAGE_KEY,
} from "../../../../files/detachedFileTreeDragBridge";
import { usePasteAndDrop } from "./usePasteAndDrop";

let windowDropHandler:
  | ((event: {
      payload: {
        type: "enter" | "over" | "leave" | "drop";
        position: { x: number; y: number };
        paths?: string[];
      };
    }) => void)
  | null = null;
let crossWindowDragBridgeHandler:
  | ((event: { payload: { type: "start"; paths: string[] } }) => void)
  | null = null;

vi.mock("../../../../../services/dragDrop.js", () => ({
  subscribeWindowDragDrop: (handler: typeof windowDropHandler) => {
    windowDropHandler = handler;
    return () => {
      windowDropHandler = null;
    };
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn(
      async (
        eventName: string,
        handler: typeof crossWindowDragBridgeHandler,
      ) => {
        if (eventName === DETACHED_FILE_TREE_DRAG_BRIDGE_EVENT) {
          crossWindowDragBridgeHandler = handler;
        }
        return () => {
          crossWindowDragBridgeHandler = null;
        };
      },
    ),
  }),
}));

type HookResult = ReturnType<typeof usePasteAndDrop>;

function createHarness(disabled = false) {
  let result: HookResult | undefined;
  const editable = document.createElement("div");
  editable.contentEditable = "true";
  editable.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 300, bottom: 120 } as DOMRect);
  document.body.appendChild(editable);

  const pathMappingRef = { current: new Map<string, string>() };
  const adjustHeight = vi.fn();
  const renderFileTags = vi.fn();
  const setHasContent = vi.fn();
  const setInternalAttachments = vi.fn();
  const onInput = vi.fn();
  const fileCompletion = { close: vi.fn() };
  const commandCompletion = { close: vi.fn() };
  const handleInput = vi.fn();
  const flushInput = vi.fn();

  function Test() {
    result = usePasteAndDrop({
      disabled,
      editableRef: { current: editable },
      pathMappingRef,
      getTextContent: () => editable.textContent ?? "",
      adjustHeight,
      renderFileTags,
      setHasContent,
      setInternalAttachments,
      onInput,
      fileCompletion,
      commandCompletion,
      handleInput,
      flushInput,
    });
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Test));
  });

  return {
    get result() {
      if (!result) {
        throw new Error("hook not ready");
      }
      return result;
    },
    editable,
    pathMappingRef,
    renderFileTags,
    onInput,
    setHasContent,
    setInternalAttachments,
    unmount() {
      act(() => root.unmount());
      container.remove();
      editable.remove();
    },
  };
}

describe("usePasteAndDrop path insertion", () => {
  afterEach(() => {
    delete window.__fileTreeDragPaths;
    delete window.__fileTreeDragStamp;
    delete window.__fileTreeDragActive;
    delete window.__fileTreeDragOverChat;
    delete window.__fileTreeDragDropped;
    window.localStorage.removeItem(DETACHED_FILE_TREE_DRAG_SNAPSHOT_STORAGE_KEY);
    crossWindowDragBridgeHandler = null;
    vi.restoreAllMocks();
  });

  it("inserts multi-path payload from custom drag data once", () => {
    vi.useFakeTimers();
    const harness = createHarness();
    try {
      const dropEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [] as File[],
          getData: (type: string) =>
            type === "application/x-doge-file-paths"
              ? JSON.stringify(["/tmp/a.ts", "/tmp/b.ts"])
              : "",
        },
      } as unknown as React.DragEvent;

      act(() => {
        harness.result.handleDrop(dropEvent);
      });

      expect(harness.editable.textContent).toContain("@/tmp/a.ts");
      expect(harness.editable.textContent).toContain("@/tmp/b.ts");
      expect(harness.pathMappingRef.current.get("a.ts")).toBe("/tmp/a.ts");
      expect(harness.pathMappingRef.current.get("b.ts")).toBe("/tmp/b.ts");
      vi.runAllTimers();
      expect(harness.renderFileTags).toHaveBeenCalled();
    } finally {
      harness.unmount();
      vi.useRealTimers();
    }
  });

  it("keeps accepting legacy codemoss drag payloads during migration", () => {
    const harness = createHarness();
    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [] as File[],
        getData: (type: string) =>
          type === "application/x-codemoss-file-paths" ? JSON.stringify(["/tmp/legacy.ts"]) : "",
      },
    } as unknown as React.DragEvent;

    act(() => {
      harness.result.handleDrop(dropEvent);
    });

    expect(harness.editable.textContent).toContain("@/tmp/legacy.ts");
    harness.unmount();
  });

  it("falls back to file-tree bridge paths when dataTransfer is empty", () => {
    const harness = createHarness();
    window.__fileTreeDragPaths = ["/tmp/from-tree.ts"];
    window.__fileTreeDragStamp = Date.now();
    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [] as File[],
        getData: () => "",
      },
    } as unknown as React.DragEvent;

    act(() => {
      harness.result.handleDrop(dropEvent);
    });

    expect(harness.editable.textContent).toContain("@/tmp/from-tree.ts");
    expect(window.__fileTreeDragPaths).toBeUndefined();
    expect(window.__fileTreeDragStamp).toBeUndefined();
    harness.unmount();
  });

  it("consumes detached window bridge paths forwarded into the main window", () => {
    const harness = createHarness();

    act(() => {
      crossWindowDragBridgeHandler?.({
        payload: {
          type: "start",
          paths: ["/tmp/from-detached-window.ts"],
        },
      });
    });

    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [] as File[],
        getData: () => "",
      },
    } as unknown as React.DragEvent;

    act(() => {
      harness.result.handleDrop(dropEvent);
    });

    expect(harness.editable.textContent).toContain("@/tmp/from-detached-window.ts");
    expect(window.__fileTreeDragPaths).toBeUndefined();
    harness.unmount();
  });

  it("accepts detached bridge drop with zero coordinates when target is inside editable", () => {
    const harness = createHarness();

    act(() => {
      crossWindowDragBridgeHandler?.({
        payload: {
          type: "start",
          paths: ["/tmp/from-detached-zero-point.ts"],
        },
      });
    });

    const dragOverEvent = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOverEvent, "clientX", { value: 0 });
    Object.defineProperty(dragOverEvent, "clientY", { value: 0 });
    act(() => {
      harness.editable.dispatchEvent(dragOverEvent);
    });

    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "clientX", { value: 0 });
    Object.defineProperty(dropEvent, "clientY", { value: 0 });
    act(() => {
      harness.editable.dispatchEvent(dropEvent);
    });

    expect(harness.editable.textContent).toContain("@/tmp/from-detached-zero-point.ts");
    expect(window.__fileTreeDragPaths).toBeUndefined();
    harness.unmount();
  });

  it("still inserts bridge paths when drop text payload is oversized", () => {
    const harness = createHarness();
    window.__fileTreeDragPaths = ["/tmp/from-tree-large.txt"];
    window.__fileTreeDragStamp = Date.now();
    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [] as File[],
        getData: (type: string) =>
          type === "text/plain" ? "x".repeat(150_000) : "",
      },
    } as unknown as React.DragEvent;

    act(() => {
      harness.result.handleDrop(dropEvent);
    });

    expect(harness.editable.textContent).toContain("@/tmp/from-tree-large.txt");
    expect(window.__fileTreeDragPaths).toBeUndefined();
    expect(window.__fileTreeDragStamp).toBeUndefined();
    harness.unmount();
  });

  it("consumes internal file-tree drag via document-level drop fallback", () => {
    const harness = createHarness();
    window.__fileTreeDragPaths = ["/tmp/from-document-drop.ts"];
    window.__fileTreeDragStamp = Date.now();
    window.__fileTreeDragActive = true;

    const dragOverEvent = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOverEvent, "clientX", { value: 10 });
    Object.defineProperty(dragOverEvent, "clientY", { value: 10 });
    act(() => {
      document.dispatchEvent(dragOverEvent);
    });

    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "clientX", { value: 10 });
    Object.defineProperty(dropEvent, "clientY", { value: 10 });
    act(() => {
      document.dispatchEvent(dropEvent);
    });

    expect(harness.editable.textContent).toContain("@/tmp/from-document-drop.ts");
    expect(window.__fileTreeDragPaths).toBeUndefined();
    expect(window.__fileTreeDragStamp).toBeUndefined();
    expect(window.__fileTreeDragActive).toBeUndefined();
    harness.unmount();
  });

  it("keeps internal drag overlay and drop behavior when document drag events report zero coordinates", () => {
    const harness = createHarness();
    window.__fileTreeDragPaths = ["/tmp/from-document-drop-zero.ts"];
    window.__fileTreeDragStamp = Date.now();
    window.__fileTreeDragActive = true;
    window.__fileTreeDragOverChat = true;
    window.__fileTreeDragPosition = { x: 10, y: 10 };

    const dragOverEvent = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOverEvent, "clientX", { value: 0 });
    Object.defineProperty(dragOverEvent, "clientY", { value: 0 });
    act(() => {
      document.dispatchEvent(dragOverEvent);
    });

    expect(harness.result.isDragOver).toBe(true);
    expect(harness.result.dragPreviewNames).toEqual(["from-document-drop-zero.ts"]);

    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "clientX", { value: 0 });
    Object.defineProperty(dropEvent, "clientY", { value: 0 });
    act(() => {
      document.dispatchEvent(dropEvent);
    });

    expect(harness.editable.textContent).toContain("@/tmp/from-document-drop-zero.ts");
    expect(window.__fileTreeDragPaths).toBeUndefined();
    expect(window.__fileTreeDragStamp).toBeUndefined();
    expect(window.__fileTreeDragActive).toBeUndefined();
    harness.unmount();
  });

  it("does not clear file-tree bridge on document dragend before source dragend fallback", () => {
    const harness = createHarness();
    window.__fileTreeDragPaths = ["/tmp/from-tree-dragend.ts"];
    window.__fileTreeDragStamp = Date.now();
    window.__fileTreeDragActive = true;

    const dragEndEvent = new Event("dragend", { bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(dragEndEvent);
    });

    expect(window.__fileTreeDragPaths).toEqual(["/tmp/from-tree-dragend.ts"]);
    expect(window.__fileTreeDragActive).toBe(true);
    harness.unmount();
  });

  it("dedupes repeated drop payload from DOM and window channels", () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [] as File[],
        getData: (type: string) =>
          type === "text/plain" ? "/tmp/a.ts" : "",
      },
    } as unknown as React.DragEvent;

    act(() => {
      harness.result.handleDrop(dropEvent);
    });

    act(() => {
      windowDropHandler?.({
        payload: { type: "drop", position: { x: 10, y: 10 }, paths: ["/tmp/a.ts"] },
      });
    });

    const allText = harness.editable.textContent ?? "";
    const referenceCount = allText.split("@/tmp/a.ts").length - 1;
    expect(referenceCount).toBe(1);
    harness.unmount();
    vi.useRealTimers();
  });

  it("consumes detached bridge paths when window drop has no paths", () => {
    const harness = createHarness();

    act(() => {
      crossWindowDragBridgeHandler?.({
        payload: {
          type: "start",
          paths: ["/tmp/from-window-drop-empty.ts"],
        },
      });
    });

    act(() => {
      windowDropHandler?.({
        payload: {
          type: "drop",
          position: { x: 10, y: 10 },
          paths: [],
        },
      });
    });

    expect(harness.editable.textContent).toContain("@/tmp/from-window-drop-empty.ts");
    expect(window.__fileTreeDragPaths).toBeUndefined();
    harness.unmount();
  });

  it("falls back to detached snapshot when bridge start event is missed", () => {
    const harness = createHarness();
    window.localStorage.setItem(
      DETACHED_FILE_TREE_DRAG_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        paths: ["/tmp/from-detached-snapshot.ts"],
        stamp: Date.now(),
      }),
    );

    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [] as File[],
        getData: () => "",
      },
    } as unknown as React.DragEvent;

    act(() => {
      harness.result.handleDrop(dropEvent);
    });

    expect(harness.editable.textContent).toContain("@/tmp/from-detached-snapshot.ts");
    harness.unmount();
  });

  it("ignores window drop outside editable bounds", () => {
    const harness = createHarness();
    act(() => {
      windowDropHandler?.({
        payload: { type: "drop", position: { x: 999, y: 999 }, paths: ["/tmp/a.ts"] },
      });
    });
    expect(harness.editable.textContent).toBe("");
    harness.unmount();
  });

  it("shows generic drag overlay for window enter/over even when paths are unavailable", () => {
    const harness = createHarness();
    expect(harness.result.isDragOver).toBe(false);

    act(() => {
      windowDropHandler?.({
        payload: { type: "enter", position: { x: 10, y: 10 } },
      });
    });
    expect(harness.result.isDragOver).toBe(true);
    expect(harness.result.dragPreviewNames).toEqual([]);

    act(() => {
      windowDropHandler?.({
        payload: { type: "leave", position: { x: 10, y: 10 } },
      });
    });
    expect(harness.result.isDragOver).toBe(false);
    harness.unmount();
  });

  it("settles window leave without position hit-testing", () => {
    const harness = createHarness();
    const getBoundingClientRect = vi.spyOn(harness.editable, "getBoundingClientRect");

    act(() => {
      windowDropHandler?.({
        payload: { type: "enter", position: { x: 10, y: 10 } },
      });
    });
    expect(harness.result.isDragOver).toBe(true);

    getBoundingClientRect.mockClear();
    act(() => {
      windowDropHandler?.({
        payload: { type: "leave", position: { x: 0, y: 0 } },
      });
    });

    expect(getBoundingClientRect).not.toHaveBeenCalled();
    expect(harness.result.isDragOver).toBe(false);
    harness.unmount();
  });

  it("normalizes window drag-drop position for high DPI coordinates", () => {
    const harness = createHarness();
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });

    const dragOverEvent = {
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ["text/plain"],
        getData: () => "",
        dropEffect: "none",
      },
    } as unknown as React.DragEvent;

    act(() => {
      harness.result.handleDragOver(dragOverEvent);
    });

    act(() => {
      windowDropHandler?.({
        payload: {
          type: "drop",
          // Simulate physical-pixel coordinates from Windows/Tauri on scale=2
          position: { x: 200, y: 200 },
          paths: ["/tmp/inside.ts"],
        },
      });
    });

    expect(harness.editable.textContent).toContain("@/tmp/inside.ts");

    Object.defineProperty(window, "devicePixelRatio", {
      value: originalDpr,
      configurable: true,
    });
    harness.unmount();
  });

  it("accepts high DPI window drop without prior dragover when scaled point is inside", () => {
    const harness = createHarness();
    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });

    act(() => {
      windowDropHandler?.({
        payload: {
          type: "drop",
          // Raw point is outside (x=400 > right=300), scaled point is inside (x=200, y=50)
          position: { x: 400, y: 100 },
          paths: ["/tmp/scaled-inside.ts"],
        },
      });
    });

    expect(harness.editable.textContent).toContain("@/tmp/scaled-inside.ts");

    Object.defineProperty(window, "devicePixelRatio", {
      value: originalDpr,
      configurable: true,
    });
    harness.unmount();
  });

  it("treats dropped image path payload as image attachment instead of file reference", () => {
    const harness = createHarness();
    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [] as File[],
        getData: (type: string) =>
          type === "text/plain" ? "C:\\Users\\demo\\Desktop\\bug.png" : "",
      },
    } as unknown as React.DragEvent;

    act(() => {
      harness.result.handleDrop(dropEvent);
    });

    expect(harness.editable.textContent).toBe("");
    expect(harness.setInternalAttachments).toHaveBeenCalled();

    const updater = harness.setInternalAttachments.mock.calls[0]?.[0] as
      | ((prev: Array<{ data: string; fileName: string; mediaType: string }>) => Array<{ data: string; fileName: string; mediaType: string }>)
      | undefined;
    expect(typeof updater).toBe("function");
    const next = updater ? updater([]) : [];
    expect(next).toHaveLength(1);
    expect(next[0]?.fileName).toBe("bug.png");
    expect(next[0]?.mediaType).toBe("image/png");
    expect(next[0]?.data).toBe("C:\\Users\\demo\\Desktop\\bug.png");

    harness.unmount();
  });

  it("splits window drop paths into image attachments and file references", () => {
    const harness = createHarness();

    const dragOverEvent = {
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        types: ["text/plain"],
        getData: () => "",
        dropEffect: "none",
      },
    } as unknown as React.DragEvent;
    act(() => {
      harness.result.handleDragOver(dragOverEvent);
    });

    act(() => {
      windowDropHandler?.({
        payload: {
          type: "drop",
          position: { x: 100, y: 100 },
          paths: [
            "/tmp/screen.png",
            "/tmp/readme.ts",
            "C:\\Users\\demo\\Desktop\\PIC.JPG",
          ],
        },
      });
    });

    expect(harness.editable.textContent).toContain("@/tmp/readme.ts");
    expect(harness.editable.textContent).not.toContain("screen.png");
    expect(harness.editable.textContent).not.toContain("PIC.JPG");

    expect(harness.setInternalAttachments).toHaveBeenCalled();
    const updater = harness.setInternalAttachments.mock.calls[0]?.[0] as
      | ((prev: Array<{ data: string; fileName: string; mediaType: string }>) => Array<{ data: string; fileName: string; mediaType: string }>)
      | undefined;
    const next = updater ? updater([]) : [];
    expect(next).toHaveLength(2);
    expect(next[0]?.fileName).toBe("screen.png");
    expect(next[0]?.mediaType).toBe("image/png");
    expect(next[1]?.fileName).toBe("PIC.JPG");
    expect(next[1]?.mediaType).toBe("image/jpeg");

    harness.unmount();
  });

  it("dedupes image-path attachments across windows path separator and drive-case variants", () => {
    const harness = createHarness();

    const firstDrop = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [] as File[],
        getData: (type: string) =>
          type === "text/plain" ? "C:\\Users\\demo\\Desktop\\bug.png" : "",
      },
    } as unknown as React.DragEvent;

    const secondDrop = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: {
        files: [] as File[],
        getData: (type: string) =>
          type === "text/plain" ? "c:/Users/demo/Desktop/bug.png" : "",
      },
    } as unknown as React.DragEvent;

    act(() => {
      harness.result.handleDrop(firstDrop);
    });
    act(() => {
      harness.result.handleDrop(secondDrop);
    });

    expect(harness.setInternalAttachments).toHaveBeenCalledTimes(2);
    const updater1 = harness.setInternalAttachments.mock.calls[0]?.[0] as
      | ((prev: Array<{ data: string; fileName: string; mediaType: string }>) => Array<{ data: string; fileName: string; mediaType: string }>)
      | undefined;
    const updater2 = harness.setInternalAttachments.mock.calls[1]?.[0] as
      | ((prev: Array<{ data: string; fileName: string; mediaType: string }>) => Array<{ data: string; fileName: string; mediaType: string }>)
      | undefined;
    const state1 = updater1 ? updater1([]) : [];
    const state2 = updater2 ? updater2(state1) : state1;
    expect(state2).toHaveLength(1);
    expect(state2[0]?.data).toBe("C:\\Users\\demo\\Desktop\\bug.png");

    harness.unmount();
  });

  it("falls back to async clipboard image read when WebView paste payload is empty", async () => {
    const imageBlob = new Blob(["fake-png"], { type: "image/png" });
    const read = vi.fn(async () => [
      {
        types: ["image/png"],
        getType: vi.fn(async (type: string) => {
          expect(type).toBe("image/png");
          return imageBlob;
        }),
      },
    ]);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { read },
    });

    const harness = createHarness();
    const pasteEvent = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [],
        getData: () => "",
      },
    } as unknown as React.ClipboardEvent;

    act(() => {
      harness.result.handlePaste(pasteEvent);
    });

    expect(pasteEvent.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(harness.setInternalAttachments).toHaveBeenCalled();
    });
    expect(read).toHaveBeenCalledTimes(1);

    const updater = harness.setInternalAttachments.mock.calls[0]?.[0] as
      | ((prev: Array<{ data: string; fileName: string; mediaType: string }>) => Array<{ data: string; fileName: string; mediaType: string }>)
      | undefined;
    expect(typeof updater).toBe("function");
    const next = updater ? updater([]) : [];
    expect(next).toHaveLength(1);
    expect(next[0]?.fileName).toMatch(/^pasted-image-\d+\.png$/);
    expect(next[0]?.mediaType).toBe("image/png");
    expect(next[0]?.data).toBe("ZmFrZS1wbmc=");

    harness.unmount();
  });
});
