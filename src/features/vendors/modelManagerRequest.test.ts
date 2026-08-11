// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  consumeVendorModelManagerRequest,
  requestVendorModelManager,
  VENDOR_MODEL_MANAGER_REQUEST_EVENT,
} from "./modelManagerRequest";

describe("modelManagerRequest", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("stores and consumes codex request", () => {
    requestVendorModelManager({
      target: "codex",
      addMode: true,
      preferredProviderProfileId: "provider-a",
    });

    const request = consumeVendorModelManagerRequest();
    expect(request).toEqual({
      target: "codex",
      addMode: true,
      preferredProviderProfileId: "provider-a",
    });

    expect(consumeVendorModelManagerRequest()).toBeNull();
  });

  it("stores and consumes gemini request", () => {
    requestVendorModelManager({ target: "gemini", addMode: true });

    const request = consumeVendorModelManagerRequest();
    expect(request).toEqual({
      target: "gemini",
      addMode: true,
      preferredProviderProfileId: null,
    });
  });

  it("defaults target to claude for unsupported payload", () => {
    window.sessionStorage.setItem(
      "doge.vendor.model-manager-request",
      JSON.stringify({ target: "other", addMode: 0 }),
    );

    expect(consumeVendorModelManagerRequest()).toEqual({
      target: "claude",
      addMode: false,
      preferredProviderProfileId: null,
    });
  });

  it("emits request event", () => {
    let fired = false;
    const listener = () => {
      fired = true;
    };
    window.addEventListener(VENDOR_MODEL_MANAGER_REQUEST_EVENT, listener);

    requestVendorModelManager({ target: "claude" });

    window.removeEventListener(VENDOR_MODEL_MANAGER_REQUEST_EVENT, listener);
    expect(fired).toBe(true);
  });
});
