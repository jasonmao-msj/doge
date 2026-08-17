import { describe, expect, it } from "vitest";
import type { EngineType } from "../../../types";
import {
  engineSupportsImageInput,
  formatEngineImageInputUnsupportedMessage,
  sanitizeImageAttachmentPaths,
} from "./engineImageInput";

describe("engineImageInput", () => {
  it.each([
    ["claude", true],
    ["codex", true],
    ["gemini", true],
    ["grok", true],
    ["kimi", true],
    ["opencode", true],
  ] as const)("engineSupportsImageInput(%s) => %s", (engine, expected) => {
    expect(engineSupportsImageInput(engine)).toBe(expected);
  });

  it("treats missing engine as supported (fail-open at client)", () => {
    expect(engineSupportsImageInput(null)).toBe(true);
    expect(engineSupportsImageInput(undefined)).toBe(true);
  });

  it("formats unsupported message with engine display label", () => {
    // Helper remains available for future engines; all current engines support images.
    expect(formatEngineImageInputUnsupportedMessage("kimi")).toContain(
      "does not support image input",
    );
  });

  it("uses i18n when provided", () => {
    const translate = (key: string, options?: Record<string, unknown>) =>
      `${key}:${String(options?.engine ?? "")}`;
    expect(formatEngineImageInputUnsupportedMessage("kimi", translate)).toBe(
      "messages.imageInputUnsupported:Kimi",
    );
  });

  it("sanitizes image paths with trim/filter/dedupe", () => {
    expect(
      sanitizeImageAttachmentPaths([
        " /tmp/a.png ",
        "",
        "  ",
        "/tmp/a.png",
        "/tmp/b.png",
        "\n",
      ]),
    ).toEqual(["/tmp/a.png", "/tmp/b.png"]);
  });

  it("marks every current engine as image-capable in the matrix projection", () => {
    const supported: EngineType[] = [
      "claude",
      "codex",
      "gemini",
      "grok",
      "kimi",
      "opencode",
    ];
    for (const engine of supported) {
      expect(engineSupportsImageInput(engine)).toBe(true);
    }
  });
});
