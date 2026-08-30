import { describe, expect, it } from "vitest";
import {
  enrichModelInfoWithAtomicReasoning,
  reconcileAtomicReasoningEffort,
  resolveAtomicDefaultReasoningEffort,
  resolveAtomicReasoningEffort,
  resolveAtomicReasoningOptions,
} from "./atomicModelReasoning";

describe("atomicModelReasoning", () => {
  it("resolves Codex gpt-5.6-sol options and default from generated catalog", () => {
    const model = { id: "gpt-5.6-sol", model: "gpt-5.6-sol" };
    const options = resolveAtomicReasoningOptions("codex", model);
    expect(options).toEqual(
      expect.arrayContaining(["low", "medium", "high", "xhigh", "max", "ultra"]),
    );
    expect(resolveAtomicDefaultReasoningEffort("codex", model)).toBe("low");
  });

  it("does not inherit Grok effort when switching to Codex catalog model", () => {
    expect(
      resolveAtomicReasoningEffort({
        engine: "codex",
        model: { id: "gpt-5.6-sol", model: "gpt-5.6-sol" },
        previousEffort: "high",
        inherit: false,
      }),
    ).toBe("low");
  });

  it("keeps same-profile effort when still allowed by the next model", () => {
    expect(
      resolveAtomicReasoningEffort({
        engine: "codex",
        model: { id: "gpt-5.6-sol", model: "gpt-5.6-sol" },
        previousEffort: "high",
        inherit: true,
      }),
    ).toBe("high");
  });

  it("drops same-profile effort that the next model does not support", () => {
    expect(
      resolveAtomicReasoningEffort({
        engine: "codex",
        model: {
          id: "slim-model",
          model: "slim-model",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
          ],
          defaultReasoningEffort: "medium",
        },
        previousEffort: "ultra",
        inherit: true,
      }),
    ).toBe("medium");
  });

  it("uses fixed Claude/Grok allowlists and null default", () => {
    expect(resolveAtomicReasoningOptions("claude", null)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(resolveAtomicReasoningOptions("grok", null)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(
      resolveAtomicReasoningEffort({
        engine: "grok",
        model: null,
        previousEffort: "medium",
        inherit: false,
      }),
    ).toBeNull();
    expect(
      resolveAtomicReasoningEffort({
        engine: "grok",
        model: null,
        previousEffort: "medium",
        inherit: true,
      }),
    ).toBe("medium");
  });

  it("enriches custom Codex models with mainstream defaults", () => {
    const enriched = enrichModelInfoWithAtomicReasoning("codex", {
      id: "my-custom",
      model: "my-custom",
      source: "custom",
    });
    expect(enriched.defaultReasoningEffort).toBe("medium");
    expect(resolveAtomicReasoningOptions("codex", enriched)).toEqual(
      expect.arrayContaining(["low", "medium", "high", "xhigh"]),
    );
  });

  it.each(["provider-custom", "provider-config"])(
    "enriches user-managed %s Codex rows but keeps runtime rows neutral",
    (source) => {
      const enriched = enrichModelInfoWithAtomicReasoning("codex", {
        id: "relay-only",
        model: "relay-only",
        source,
      });
      expect(enriched.defaultReasoningEffort).toBe("medium");
      expect(resolveAtomicReasoningOptions("codex", enriched)).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
      ]);
    },
  );

  it("keeps unknown runtime Codex models capability-neutral", () => {
    const model = {
      id: "some-runtime-only-model",
      model: "some-runtime-only-model",
      source: "runtime",
    };
    expect(resolveAtomicReasoningOptions("codex", model)).toEqual([]);
    expect(resolveAtomicDefaultReasoningEffort("codex", model)).toBeNull();
  });

  it("fills missing supported efforts when only default is present", () => {
    const enriched = enrichModelInfoWithAtomicReasoning("codex", {
      id: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: [],
    });
    const options = resolveAtomicReasoningOptions("codex", enriched);
    expect(options).toEqual(
      expect.arrayContaining(["low", "medium", "high", "xhigh", "max", "ultra"]),
    );
    expect(enriched.defaultReasoningEffort).toBe("low");
  });

  it("reconciles null Codex effort to catalog default for known models", () => {
    expect(
      reconcileAtomicReasoningEffort({
        engine: "codex",
        model: { id: "gpt-5.6-sol", model: "gpt-5.6-sol" },
        effort: null,
      }),
    ).toBe("low");
  });

  it("reconciles invalid Codex effort to model default", () => {
    expect(
      reconcileAtomicReasoningEffort({
        engine: "codex",
        model: {
          id: "slim",
          model: "slim",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
          ],
          defaultReasoningEffort: "medium",
        },
        effort: "ultra",
      }),
    ).toBe("medium");
  });

  it("reconciles Claude invalid effort to null Default", () => {
    expect(
      reconcileAtomicReasoningEffort({
        engine: "claude",
        model: null,
        effort: "not-a-level",
      }),
    ).toBeNull();
  });
});
