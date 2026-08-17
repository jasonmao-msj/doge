import { describe, expect, it, vi } from "vitest";
import { createManagedEngineToolchainClientV1 } from "./managedEngineToolchain";

function ready(source: "bundled" | "external") {
  return {
    ok: true,
    value: {
      engineId: "codex",
      status: "ready",
      bundledVersion: "0.147.0",
      externalVersion: source === "external" ? "0.148.0" : null,
      selectedSource: source,
    },
  };
}

function choiceRequired() {
  return {
    ok: true,
    value: {
      engineId: "codex",
      status: "choiceRequired",
      bundledVersion: "0.147.0",
      externalVersion: "0.146.0",
      selectedSource: null,
    },
  };
}

describe("managed engine toolchain client", () => {
  it("accepts an automatic bundled selection without storage", async () => {
    const resolve = vi.fn(async () => ready("bundled"));
    const client = createManagedEngineToolchainClientV1({ resolve, storage: null });
    await expect(client.inspect("codex")).resolves.toMatchObject({
      ok: true,
      value: { selectedSource: "bundled" },
    });
    expect(resolve).toHaveBeenCalledWith("codex", null);
  });

  it("returns an explicit choice when the external engine is older", async () => {
    const client = createManagedEngineToolchainClientV1({
      resolve: vi.fn(async () => choiceRequired()),
      storage: null,
    });
    await expect(client.inspect("codex")).resolves.toMatchObject({
      ok: true,
      value: { status: "choiceRequired", externalVersion: "0.146.0" },
    });
  });

  it("remembers a version-scoped choice and reuses it without prompting", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const resolve = vi.fn(async (_engineId, choice) => choice ? ready(choice) : choiceRequired());
    const client = createManagedEngineToolchainClientV1({ resolve, storage });
    const versions = { bundledVersion: "0.147.0", externalVersion: "0.146.0" };
    await expect(client.choose("codex", "bundled", versions)).resolves.toMatchObject({ ok: true });
    await expect(client.inspect("codex")).resolves.toMatchObject({
      ok: true,
      value: { status: "ready", selectedSource: "bundled" },
    });
    expect(resolve).toHaveBeenLastCalledWith("codex", "bundled");
  });

  it("fails closed on an invalid native envelope", async () => {
    const client = createManagedEngineToolchainClientV1({
      resolve: vi.fn(async () => ({ ok: true, value: { status: "ready" } })),
      storage: null,
    });
    await expect(client.inspect("codex")).resolves.toEqual({
      ok: false,
      error: { code: "protocolMismatch" },
    });
  });
});
