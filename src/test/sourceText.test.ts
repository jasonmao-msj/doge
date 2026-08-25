import { describe, expect, it } from "vitest";
import { normalizeSourceText } from "./sourceText";

describe("normalizeSourceText", () => {
  it("normalizes CRLF and legacy CR without changing LF text", () => {
    expect(normalizeSourceText("a\r\nb\rc\n")).toBe("a\nb\nc\n");
  });
});
