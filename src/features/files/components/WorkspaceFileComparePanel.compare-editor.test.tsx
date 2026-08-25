/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";

const { dispatch, flashNavigationLine } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  flashNavigationLine: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/utils/fileRenderProfile", () => ({
  resolveFileRenderProfile: () => ({ editorLanguage: null }),
}));

vi.mock("../utils/codemirrorLanguageExtensions", () => ({
  loadCodeMirrorExtensionsForEditorLanguage: vi.fn(async () => []),
}));

vi.mock("./FileCodeMirrorEditor", () => ({
  FileCodeMirrorEditor: ({
    cmRef,
    editable,
    gitLineMarkers,
    lineNumberLabels,
  }: {
    cmRef: MutableRefObject<unknown>;
    editable: boolean;
    gitLineMarkers: { added: number[]; modified: number[] };
    lineNumberLabels?: readonly (number | null)[] | null;
  }) => {
    cmRef.current = {
      view: {
        state: {
          doc: {
            lines: 3,
            line: (lineNumber: number) => ({ from: lineNumber * 10 }),
          },
        },
        dispatch,
      },
      flashNavigationLine,
    };
    return (
      <div
        data-testid="code-mirror"
        data-editable={String(editable)}
        data-markers={JSON.stringify(gitLineMarkers)}
        data-line-number-labels={JSON.stringify(lineNumberLabels ?? null)}
      />
    );
  },
}));

import {
  CompareEditorColumn,
  type CompareColumnDraft,
} from "./WorkspaceFileComparePanel";

const READ_ONLY_DRAFT: CompareColumnDraft = {
  id: "source:example.ts",
  label: "example.ts",
  title: "Source code",
  content: "first\nchanged\nlast",
  isDirty: false,
  isSaving: false,
  isLoading: false,
  error: null,
  saveError: null,
  truncated: false,
  readOnlyReason: null,
  editable: false,
  onChange: vi.fn(),
  onSave: vi.fn(() => false),
};

describe("CompareEditorColumn read-only rendering", () => {
  beforeEach(() => {
    dispatch.mockClear();
    flashNavigationLine.mockClear();
  });

  it("keeps a normal read-only column in CodeMirror with semantic tone and navigation", async () => {
    const { container } = render(
      <CompareEditorColumn
        draft={READ_ONLY_DRAFT}
        editorTheme="dark"
        markers={{ added: [], modified: [2] }}
        lineGaps={[]}
        activeLineNumber={2}
        diffTone="addition"
        lineNumberLabels={[60, 61, 62]}
      />,
    );

    expect(screen.getByTestId("code-mirror").getAttribute("data-editable")).toBe("false");
    expect(screen.getByTestId("code-mirror").getAttribute("data-markers")).toBe(
      JSON.stringify({ added: [], modified: [2] }),
    );
    expect(screen.getByTestId("code-mirror").getAttribute("data-line-number-labels"))
      .toBe(JSON.stringify([60, 61, 62]));
    expect(container.querySelector(".file-compare-column")?.classList.contains("is-diff-addition"))
      .toBe(true);
    expect(container.querySelector(".file-compare-readonly-content")).toBeNull();
    await waitFor(() => expect(flashNavigationLine).toHaveBeenCalledWith(2));
    expect(dispatch).toHaveBeenCalledWith({
      selection: { anchor: 20 },
      scrollIntoView: true,
    });
  });

  it("keeps explicit unsupported state on the plain-text fallback", () => {
    const { container } = render(
      <CompareEditorColumn
        draft={{ ...READ_ONLY_DRAFT, readOnlyReason: "Unsupported" }}
        editorTheme="dark"
        markers={{ added: [], modified: [2] }}
        lineGaps={[]}
        activeLineNumber={2}
        diffTone="deletion"
      />,
    );

    expect(screen.queryByTestId("code-mirror")).toBeNull();
    expect(container.querySelector(".file-compare-readonly-content")?.textContent)
      .toBe(READ_ONLY_DRAFT.content);
  });
});
