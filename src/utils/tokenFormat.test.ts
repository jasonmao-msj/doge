import { describe, expect, it } from "vitest";
import { formatTokenCount } from "./tokenFormat";

describe("formatTokenCount", () => {
  it("uses locale-independent uppercase K, M, and B units", () => {
    expect(formatTokenCount(721)).toBe("721");
    expect(formatTokenCount(7_219)).toBe("7.2K");
    expect(formatTokenCount(199_000)).toBe("199K");
    expect(formatTokenCount(700_000)).toBe("700K");
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
    expect(formatTokenCount(2_419_000_000)).toBe("2.42B");
  });
});
