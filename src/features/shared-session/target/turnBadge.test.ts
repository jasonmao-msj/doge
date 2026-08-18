import { describe, expect, it } from "vitest";

import { resolveTurnBadge } from "./turnBadge";
import {
  freezeTurnSnapshot,
  type TurnExecutionSnapshot,
} from "./types";

describe("resolveTurnBadge", () => {
  it("renders provider name snapshot and model from the frozen snapshot", () => {
    const snapshot = freezeTurnSnapshot(
      { engine: "claude", providerProfileId: "openrouter", model: "sonnet" },
      { providerProfileNameSnapshot: "OpenRouter" },
    );
    const badge = resolveTurnBadge(snapshot);
    expect(badge).toEqual({
      engine: "claude",
      engineLabel: "Claude",
      providerLabel: "OpenRouter",
      modelLabel: "sonnet",
      reasoningLabel: null,
      unavailable: false,
      unavailableReason: null,
    });
  });

  it("keeps name snapshot readable after the provider is deleted", () => {
    const snapshot = freezeTurnSnapshot(
      { engine: "claude", providerProfileId: "openrouter" },
      { providerProfileNameSnapshot: "OpenRouter" },
    );
    const badge = resolveTurnBadge(snapshot, {
      providerExists: false,
      providerAvailable: false,
      runtimeAvailable: true,
    });
    expect(badge.providerLabel).toBe("OpenRouter");
    expect(badge.unavailable).toBe(true);
    expect(badge.unavailableReason).toBe("provider-deleted");
  });

  it("marks unavailable when provider config is missing", () => {
    const snapshot = freezeTurnSnapshot({ engine: "claude", providerProfileId: "zhipu" });
    const badge = resolveTurnBadge(snapshot, {
      providerExists: true,
      providerAvailable: false,
      runtimeAvailable: true,
    });
    expect(badge.unavailableReason).toBe("provider-missing");
  });

  it("marks unavailable when runtime is gone even if provider is fine", () => {
    const snapshot = freezeTurnSnapshot({ engine: "codex", providerProfileId: null });
    const badge = resolveTurnBadge(snapshot, {
      providerExists: true,
      providerAvailable: true,
      runtimeAvailable: false,
    });
    expect(badge.unavailableReason).toBe("runtime-missing");
  });

  it("does not fabricate local identity for legacy snapshots", () => {
    const snapshot: TurnExecutionSnapshot = {
      engine: "claude",
      providerProfileId: null,
      providerProfileNameSnapshot: null,
      providerProfileSource: null,
    };
    const badge = resolveTurnBadge(snapshot);
    expect(badge.providerLabel).toBe("历史配置未知");
    expect(badge.unavailable).toBe(false);
  });

  it("converts explicit disk selection to canonical local source", () => {
    const snapshot = freezeTurnSnapshot({
      engine: "codex",
      providerProfileId: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
    });
    expect(snapshot.providerProfileSource).toBe("local");
    const badge = resolveTurnBadge(snapshot);
    expect(badge.engineLabel).toBe("Codex");
    expect(badge.providerLabel).toBe("本地配置");
  });

  it("keeps Grok engine identity readable in historical snapshots", () => {
    const badge = resolveTurnBadge({
      engine: "grok",
      providerProfileId: null,
      providerProfileNameSnapshot: "Grok 本地配置",
      providerProfileSource: "local",
    });
    expect(badge.engineLabel).toBe("Grok");
    expect(badge.providerLabel).toBe("Grok 本地配置");
  });

  it("preserves managed source while freezing the snapshot", () => {
    const snapshot = freezeTurnSnapshot({
      engine: "codex",
      providerProfileId: "provider-openai",
      providerProfileSource: "managed",
    });
    expect(snapshot.providerProfileSource).toBe("managed");
  });
});
