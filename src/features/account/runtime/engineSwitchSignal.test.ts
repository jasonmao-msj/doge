// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  publishAccountEngineReadyV1,
  requestAccountEngineSwitchV1,
  subscribeAccountEngineReadyV1,
  subscribeAccountEngineSwitchV1,
} from "./engineSwitchSignal";

describe("account engine switch signal", () => {
  it("preserves the target engine and post-activation landing intent", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAccountEngineSwitchV1(listener);

    requestAccountEngineSwitchV1({
      source: "enginePicker",
      targetEngineId: "claude-code",
      openNewConversation: true,
    });

    expect(listener).toHaveBeenCalledWith({
      source: "enginePicker",
      targetEngineId: "claude-code",
      openNewConversation: true,
    });
    unsubscribe();
  });

  it("publishes only a credential-free committed engine result", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAccountEngineReadyV1(listener);

    publishAccountEngineReadyV1({
      engineId: "claude-code",
      openNewConversation: true,
    });

    expect(listener).toHaveBeenCalledWith({
      engineId: "claude-code",
      openNewConversation: true,
    });
    unsubscribe();
  });

  it("keeps the legacy no-detail request on the account-center path", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAccountEngineSwitchV1(listener);

    window.dispatchEvent(new Event("doge:account-engine-switch"));

    expect(listener).toHaveBeenCalledWith({
      source: "accountCenter",
      targetEngineId: null,
      openNewConversation: true,
    });
    unsubscribe();
  });
});
