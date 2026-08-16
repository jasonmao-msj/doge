// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMainHeaderActionItems } from "./MainHeaderActions";

const translate = (key: string) => key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

describe("useMainHeaderActionItems", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns header actions for the open app command menu", () => {
    const onToggleSoloMode = vi.fn();
    const onCollapseRightPanel = vi.fn();

    const { result } = renderHook(() =>
      useMainHeaderActionItems({
        isCompact: false,
        rightPanelCollapsed: false,
        sidebarToggleProps: {
          isCompact: false,
          sidebarCollapsed: false,
          rightPanelCollapsed: false,
          rightPanelAvailable: true,
          onCollapseSidebar: vi.fn(),
          onExpandSidebar: vi.fn(),
          onCollapseRightPanel,
          onExpandRightPanel: vi.fn(),
        },
        showSoloButton: true,
        onToggleSoloMode,
      }),
    );

    const labels = result.current.map((item) => item.label);
    expect(labels).toContain("sidebar.enterSoloMode");
    expect(labels).toContain("sidebar.hideGitSidebar");

    result.current.find((item) => item.id === "solo-mode")?.onSelect();
    result.current.find((item) => item.id === "right-panel")?.onSelect();

    expect(onToggleSoloMode).toHaveBeenCalledTimes(1);
    expect(onCollapseRightPanel).toHaveBeenCalledTimes(1);
  });

  it("returns no actions in compact mode", () => {
    const { result } = renderHook(() =>
      useMainHeaderActionItems({
        isCompact: true,
        rightPanelCollapsed: false,
        sidebarToggleProps: {
          isCompact: true,
          sidebarCollapsed: false,
          rightPanelCollapsed: false,
          rightPanelAvailable: true,
          onCollapseSidebar: vi.fn(),
          onExpandSidebar: vi.fn(),
          onCollapseRightPanel: vi.fn(),
          onExpandRightPanel: vi.fn(),
        },
        showSoloButton: true,
        onToggleSoloMode: vi.fn(),
      }),
    );

    expect(result.current).toEqual([]);
  });

  it("keeps the action array reference stable when logical inputs are unchanged", () => {
    const onToggleSoloMode = vi.fn();
    const onCollapseRightPanel = vi.fn();
    const onExpandRightPanel = vi.fn();

    const { result, rerender } = renderHook(
      ({ isSoloMode }) =>
        useMainHeaderActionItems({
          isCompact: false,
          rightPanelCollapsed: false,
          sidebarToggleProps: {
            isCompact: false,
            sidebarCollapsed: false,
            rightPanelCollapsed: false,
            rightPanelAvailable: true,
            onCollapseSidebar: vi.fn(),
            onExpandSidebar: vi.fn(),
            onCollapseRightPanel,
            onExpandRightPanel,
          },
          showSoloButton: true,
          isSoloMode,
          onToggleSoloMode,
        }),
      { initialProps: { isSoloMode: false } },
    );

    const previousActions = result.current;

    rerender({ isSoloMode: false });

    expect(result.current).toBe(previousActions);

    rerender({ isSoloMode: true });

    expect(result.current).not.toBe(previousActions);
    expect(result.current.find((item) => item.id === "solo-mode")?.active).toBe(true);
  });

  it("adds file compare action to the open app command menu", () => {
    const onOpenFileCompare = vi.fn();

    const { result } = renderHook(() =>
      useMainHeaderActionItems({
        isCompact: false,
        rightPanelCollapsed: false,
        sidebarToggleProps: {
          isCompact: false,
          sidebarCollapsed: false,
          rightPanelCollapsed: false,
          rightPanelAvailable: false,
          onCollapseSidebar: vi.fn(),
          onExpandSidebar: vi.fn(),
          onCollapseRightPanel: vi.fn(),
          onExpandRightPanel: vi.fn(),
        },
        showFileCompareButton: true,
        isFileCompareActive: true,
        onOpenFileCompare,
      }),
    );

    const action = result.current.find((item) => item.id === "file-compare");
    expect(action?.label).toBe("files.fileCompare.title");
    expect(action?.active).toBe(true);

    action?.onSelect();
    expect(onOpenFileCompare).toHaveBeenCalledTimes(1);
  });

  it("opens the shared Settings account surface from the optional header action", () => {
    const onOpenAccount = vi.fn();
    const { result } = renderHook(() =>
      useMainHeaderActionItems({
        isCompact: false,
        rightPanelCollapsed: false,
        sidebarToggleProps: {
          isCompact: false,
          sidebarCollapsed: false,
          rightPanelCollapsed: false,
          rightPanelAvailable: false,
          onCollapseSidebar: vi.fn(),
          onExpandSidebar: vi.fn(),
          onCollapseRightPanel: vi.fn(),
          onExpandRightPanel: vi.fn(),
        },
        showAccountButton: true,
        onOpenAccount,
      }),
    );

    const action = result.current.find((item) => item.id === "account");
    expect(action?.label).toBe("settings.sidebarAccount");
    action?.onSelect();
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
  });
});
