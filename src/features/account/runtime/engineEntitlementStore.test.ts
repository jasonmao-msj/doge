import { beforeEach, describe, expect, it } from "vitest";
import {
  clearManagedEngineEntitlementsV1,
  clearManagedEnginePreparedV1,
  isManagedEnginePreparedV1,
  MANAGED_PROVIDER_PROFILE_ID_V1,
  markManagedEnginePreparedV1,
  publishManagedEngineEntitlementsV1,
  readManagedEngineEntitlementsV1,
  readManagedEnginePreparationV1,
} from "./engineEntitlementStore";

const activeCatalog = [
  {
    id: "codex" as const,
    displayName: "Codex",
    entitlement: { status: "active" as const, expiresAt: null },
  },
  {
    id: "claude-code" as const,
    displayName: "Claude",
    entitlement: { status: "none" as const, expiresAt: null },
  },
];

describe("engine entitlement store", () => {
  beforeEach(() => {
    clearManagedEngineEntitlementsV1();
  });

  it("does not promote an active catalog entitlement to prepared", () => {
    publishManagedEngineEntitlementsV1(activeCatalog);

    expect(readManagedEngineEntitlementsV1().codex).toBe("active");
    expect(readManagedEnginePreparationV1().codex).toBe("unprepared");
    expect(isManagedEnginePreparedV1("codex")).toBe(false);
  });

  it("exposes prepared only after the account activation transaction commits", () => {
    publishManagedEngineEntitlementsV1(activeCatalog);
    markManagedEnginePreparedV1("codex");

    expect(readManagedEnginePreparationV1().codex).toBe("prepared");
    expect(isManagedEnginePreparedV1("codex")).toBe(true);

    clearManagedEnginePreparedV1("codex");
    expect(readManagedEnginePreparationV1().codex).toBe("unprepared");
    expect(isManagedEnginePreparedV1("codex")).toBe(false);
  });

  it("does not prepare an inactive entitlement and clears all state on logout", () => {
    markManagedEnginePreparedV1("codex");
    expect(isManagedEnginePreparedV1("codex")).toBe(false);

    publishManagedEngineEntitlementsV1(activeCatalog);
    markManagedEnginePreparedV1("codex");
    clearManagedEngineEntitlementsV1();

    expect(readManagedEngineEntitlementsV1()).toEqual({
      codex: "unknown",
      "claude-code": "unknown",
    });
    expect(readManagedEnginePreparationV1()).toEqual({
      codex: "unknown",
      "claude-code": "unknown",
    });
  });

  it("keeps the managed provider identity closed and exact", () => {
    expect(MANAGED_PROVIDER_PROFILE_ID_V1).toBe("doge-token-matrix");
  });
});
