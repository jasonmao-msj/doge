import { describe, expect, it } from "vitest";
import { resolveSessionEngineActivation } from "./engineSessionRouting";

describe("resolveSessionEngineActivation", () => {
  it("requires native confirmation for Codex", () => {
    expect(resolveSessionEngineActivation("codex")).toEqual({
      requireSuccess: true,
      options: { ensureRuntime: true },
    });
  });

  it("keeps Kimi provider routing explicit without requiring global activation", () => {
    expect(resolveSessionEngineActivation("kimi", " provider-kimi ")).toEqual({
      requireSuccess: false,
      options: { providerProfileId: "provider-kimi" },
    });
  });

  it("requires managed Claude activation while preserving provider identity", () => {
    expect(resolveSessionEngineActivation("claude", "doge-token-matrix")).toEqual({
      requireSuccess: true,
      options: {
        ensureRuntime: true,
        providerProfileId: "doge-token-matrix",
      },
    });
  });
});
