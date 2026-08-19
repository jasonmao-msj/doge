import { describe, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => ({ activate: vi.fn() }));

vi.mock("./tauri/accountEngine", () => ({
  activateAccountEngineV1: commands.activate,
}));

import { activateAccountManagedEngine } from "./accountEngineActivation";

describe("activateAccountManagedEngine", () => {
  it("uses the account-scoped activation command with the managed engine id", async () => {
    commands.activate.mockResolvedValue(undefined);

    await activateAccountManagedEngine("codex");

    expect(commands.activate).toHaveBeenCalledWith("codex");
  });
});
