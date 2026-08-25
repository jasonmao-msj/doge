import { describe, expect, it } from "vitest";
import { createFileDocumentSnapshot } from "./fileDocumentSnapshot";

describe("fileDocumentSnapshot", () => {
  it("builds bounded line access for LF and CRLF without changing visible line numbers", () => {
    const snapshot = createFileDocumentSnapshot("alpha\r\nbeta\ngamma\n", false, 7);

    expect(snapshot.snapshotVersion).toBe(7);
    expect(snapshot.lineCount).toBe(4);
    expect(snapshot.getLineText(0)).toBe("alpha");
    expect(snapshot.getLineText(1)).toBe("beta");
    expect(snapshot.getLineText(2)).toBe("gamma");
    expect(snapshot.getLineText(3)).toBe("");
    expect(snapshot.getLines(1, 3)).toEqual(["beta", "gamma"]);
  });

  it("keeps content and metadata together for multibyte content", () => {
    const snapshot = createFileDocumentSnapshot("A好\nB", true, 2);

    expect(snapshot.content).toBe("A好\nB");
    expect(snapshot.byteLength).toBe(6);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.contentHash).toMatch(/^[0-9a-z]+$/);
  });
});
