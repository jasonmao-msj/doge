import { beforeEach, describe, expect, it } from "vitest";
import {
  resetClientStorageForTests,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import {
  readLastManagedEnginePreferenceV1,
  writeLastManagedEnginePreferenceV1,
} from "./enginePreference";

describe("managed engine preference", () => {
  beforeEach(() => resetClientStorageForTests());

  it("returns null for missing and malformed persisted values", () => {
    expect(readLastManagedEnginePreferenceV1()).toBeNull();
    writeClientStoreValue("app", "account.lastManagedEngine", "gemini");
    expect(readLastManagedEnginePreferenceV1()).toBeNull();
  });

  it("round-trips the closed managed engine identity", () => {
    writeLastManagedEnginePreferenceV1("claude-code");
    expect(readLastManagedEnginePreferenceV1()).toBe("claude-code");
  });
});
