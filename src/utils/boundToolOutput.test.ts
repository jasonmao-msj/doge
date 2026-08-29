// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boundToolOutput,
  COMMAND_EXECUTION_OUTPUT_BUDGET,
  COMMAND_EXECUTION_OUTPUT_HEAD,
  FILE_CHANGE_OUTPUT_BUDGET,
} from "./boundToolOutput";
import {
  __resetRealtimePerfFlagCacheForTests,
  resetRealtimePerfFlags,
} from "@/conversation-presentation/realtimePerfFlags";

describe("boundToolOutput", () => {
  beforeEach(() => resetRealtimePerfFlags());
  afterEach(() => {
    resetRealtimePerfFlags();
    __resetRealtimePerfFlagCacheForTests();
  });

  it("keeps the command head and recent tail under 256 KiB", () => {
    const text =
      "H".repeat(COMMAND_EXECUTION_OUTPUT_HEAD) +
      "M".repeat(512_000) +
      "T".repeat(80_000);
    const bounded = boundToolOutput(text, "commandExecution");
    expect(bounded.length).toBeLessThanOrEqual(COMMAND_EXECUTION_OUTPUT_BUDGET);
    expect(bounded.startsWith("H".repeat(COMMAND_EXECUTION_OUTPUT_HEAD))).toBe(true);
    expect(bounded.endsWith("T".repeat(1000))).toBe(true);
    expect(bounded).toMatch(/omitted \d+ chars/);
  });

  it("accumulates omitted count after another append", () => {
    const first = boundToolOutput(
      `${"A".repeat(COMMAND_EXECUTION_OUTPUT_HEAD)}${"B".repeat(400_000)}`,
      "commandExecution",
    );
    const firstOmitted = Number(first.match(/omitted (\d+) chars/)?.[1] ?? 0);
    const next = boundToolOutput(`${first}${"C".repeat(80_000)}`, "commandExecution");
    const nextOmitted = Number(next.match(/omitted (\d+) chars/)?.[1] ?? 0);
    expect(next.length).toBeLessThanOrEqual(COMMAND_EXECUTION_OUTPUT_BUDGET);
    expect(nextOmitted).toBeGreaterThan(firstOmitted);
  });

  it("uses the larger fileChange budget and leaves unknown tools untouched", () => {
    const diff = "x".repeat(FILE_CHANGE_OUTPUT_BUDGET + 50_000);
    expect(boundToolOutput(diff, "fileChange").length).toBeLessThanOrEqual(
      FILE_CHANGE_OUTPUT_BUDGET,
    );
    expect(boundToolOutput(diff, "webSearch")).toBe(diff);
  });

  it("supports a doge rollback flag", () => {
    window.localStorage.setItem("doge.perf.toolOutputBudget", "off");
    const text = "z".repeat(COMMAND_EXECUTION_OUTPUT_BUDGET + 10_000);
    expect(boundToolOutput(text, "commandExecution")).toBe(text);
  });
});
