/** @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RollingStat } from "./RollingStat";

vi.mock("@number-flow/react", async () => {
  const continuous = {};
  function NumberFlow(props: {
    value: number;
    prefix?: string;
    className?: string;
  }) {
    return (
      <span className={props.className} data-nf-value={props.value}>
        {props.prefix}
        {props.value}
      </span>
    );
  }
  return {
    __esModule: true,
    default: NumberFlow,
    continuous,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RollingStat", () => {
  it("renders prefix and animates from 0 to target after mount", async () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue[id - 1] = () => {};
    });

    render(<RollingStat prefix="+" value={12} data-testid="stat" />);
    const el = screen.getByTestId("stat");
    expect(el.getAttribute("data-value")).toBe("12");
    expect(el.getAttribute("aria-label")).toBe("+12");
    // 首帧 display 为 0
    expect(el.getAttribute("data-display-value")).toBe("0");

    await act(async () => {
      const first = [...rafQueue];
      rafQueue.length = 0;
      first.forEach((cb) => cb(performance.now()));
      const second = [...rafQueue];
      rafQueue.length = 0;
      second.forEach((cb) => cb(performance.now()));
    });

    expect(el.getAttribute("data-display-value")).toBe("12");
    expect(el.textContent ?? "").toContain("12");
    expect(el.textContent ?? "").toContain("+");
  });

  it("updates data-value when props change", async () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const flush = async () => {
      await act(async () => {
        const batch = [...rafQueue];
        rafQueue.length = 0;
        batch.forEach((cb) => cb(performance.now()));
        const batch2 = [...rafQueue];
        rafQueue.length = 0;
        batch2.forEach((cb) => cb(performance.now()));
      });
    };

    const { rerender } = render(
      <RollingStat prefix="+" value={12} data-testid="stat" />,
    );
    await flush();
    rerender(<RollingStat prefix="+" value={87} data-testid="stat" />);
    expect(screen.getByTestId("stat").getAttribute("data-value")).toBe("87");
    expect(screen.getByTestId("stat").getAttribute("aria-label")).toBe("+87");
    await flush();
    expect(screen.getByTestId("stat").getAttribute("data-display-value")).toBe(
      "87",
    );
  });
});
