import type {
  GatewayCallContextV1,
  GatewayOperationNameV1,
  GatewayReadContextV1,
} from "../contracts/gateway";
import type {
  AccountHandleBindingV1,
  GatewayFailureV1,
  GatewayResultV1,
} from "../contracts/semantic";
import {
  apiKeyCandidateHandleV1,
  authAttemptHandleV1,
  externalIntentHandleV1,
  oauthAttemptHandleV1,
} from "../contracts/semantic";
import type { ScenarioOperationResolutionV1 } from "./ScenarioRuntimeV1";
import type { ScenarioRuntimeV1 } from "./ScenarioRuntimeV1";

type OperationContextV1 = GatewayReadContextV1 | GatewayCallContextV1;

export const CODEX_RECIPE_V1 = {
  recipeId: "doge.account.codex-token-service",
  recipeVersion: 1,
} as const;

export function handleBindingV1(
  runtime: ScenarioRuntimeV1,
  purpose: string,
  ttlSeconds = 300,
): AccountHandleBindingV1 {
  return {
    purpose,
    accountEpoch: runtime.getSnapshot().scenarioEpoch,
    processGeneration: 1,
    expiresAtEpochSeconds:
      Math.floor(Date.parse(runtime.nowIso()) / 1_000) + ttlSeconds,
  };
}

export function handleNonceV1(runtime: ScenarioRuntimeV1): string {
  return runtime.nextSafeToken("synthetic");
}

export function authAttemptV1(runtime: ScenarioRuntimeV1, purpose: string) {
  return authAttemptHandleV1(
    handleBindingV1(runtime, purpose),
    handleNonceV1(runtime),
  );
}

export function oauthAttemptV1(runtime: ScenarioRuntimeV1, purpose: string) {
  return oauthAttemptHandleV1(
    handleBindingV1(runtime, purpose),
    handleNonceV1(runtime),
  );
}

export function externalIntentV1(runtime: ScenarioRuntimeV1, purpose: string) {
  return externalIntentHandleV1(
    handleBindingV1(runtime, purpose),
    handleNonceV1(runtime),
  );
}

export function apiKeyCandidateV1(runtime: ScenarioRuntimeV1) {
  return apiKeyCandidateHandleV1(
    handleBindingV1(runtime, "codex-api-key", 600),
    handleNonceV1(runtime),
  );
}

export function successV1<T>(value: T): GatewayResultV1<T> {
  return { ok: true, value };
}

export function stageForOperationV1(
  operation: GatewayOperationNameV1,
): GatewayFailureV1["stage"] {
  if (operation.startsWith("humanVerification.")) return "challenge";
  if (operation.startsWith("auth.beginRegistration")) return "register";
  if (
    operation.startsWith("auth.resendRegistration") ||
    operation.startsWith("auth.submitRegistration")
  )
    return "verifyEmail";
  if (operation === "auth.login") return "login";
  if (operation === "auth.verifyMfa") return "mfa";
  if (
    operation === "auth.startOAuth" ||
    operation === "auth.cancelOAuth" ||
    operation === "auth.readOAuthAttempt" ||
    operation === "auth.completeOAuthAccount" ||
    operation === "profile.startIdentityBinding"
  )
    return "oauth";
  if (operation === "auth.requestPasswordReset") return "recover";
  if (
    operation === "auth.inspectExternalIntent" ||
    operation === "auth.resetPassword"
  )
    return "reset";
  if (operation === "auth.logout") return "logout";
  if (operation.startsWith("profile.")) return "security";
  if (operation === "usage.read") return "usage";
  if (operation.startsWith("managedKey.")) return "managedKey";
  if (
    operation === "configuration.createPlan" ||
    operation === "configuration.readFileDetail" ||
    operation === "configuration.readOffer"
  )
    return "configurationPlan";
  if (operation.startsWith("configuration.")) return "configurationApply";
  return "capabilities";
}

export function failureForResolutionV1(
  resolution: ScenarioOperationResolutionV1,
  context: OperationContextV1,
): GatewayFailureV1 {
  const stage = stageForOperationV1(resolution.operation);
  if (resolution.result === "outcomeUnknown") {
    if ("intent" in context) {
      return {
        code: "outcomeUnknown",
        stage,
        recovery: { action: "reconcile", intent: context.intent },
      };
    }
    return {
      code: "outcomeUnknown",
      stage,
      recovery: { action: "retry", afterMs: null },
    };
  }
  switch (resolution.fault) {
    case "offline":
      return { code: "offline", stage, recovery: { action: "useLocalMode" } };
    case "serviceUnavailable":
      return {
        code: "serviceUnavailable",
        stage,
        recovery: { action: "retry", afterMs: null },
      };
    case "vaultUnavailable":
      return {
        code: "vaultUnavailable",
        stage: "vault",
        recovery: { action: "useLocalMode" },
      };
    case "concurrentEdit":
      return {
        code: "concurrentEdit",
        stage,
        recovery: { action: "replan" },
      };
    case "unsafeTarget":
      return {
        code: "unsafeTarget",
        stage,
        recovery: { action: "reviewFiles" },
      };
    case "rollbackFailure":
      return {
        code: "rollbackIncomplete",
        stage,
        recovery: { action: "reviewFiles" },
      };
    case "unsupportedMajor":
      return {
        code: "contractUnsupported",
        stage,
        recovery: { action: "useLocalMode" },
      };
    case "missingGuarantee":
      return {
        code: "capabilityUnavailable",
        stage,
        recovery: { action: "useLocalMode" },
      };
    case "unknownEnum":
    case "metadataFailure":
      return {
        code: "protocolMismatch",
        stage,
        recovery: { action: "useLocalMode" },
      };
    case "lostResponse":
      return {
        code: "outcomeUnknown",
        stage,
        recovery:
          "intent" in context
            ? { action: "reconcile", intent: context.intent }
            : { action: "retry", afterMs: null },
      };
    case null:
      return scenarioFailureV1(resolution);
  }
}

export function scenarioFailureV1(
  resolution: ScenarioOperationResolutionV1,
): GatewayFailureV1 {
  const id = resolution.scenarioId;
  const stage = stageForOperationV1(resolution.operation);
  if (id.includes("credentials-rejected")) {
    return {
      code: "credentialsRejected",
      stage: "login",
      recovery: { action: "editInput", field: "password" },
    };
  }
  if (id.includes("mfa") && id.includes("expiry")) {
    return {
      code: "mfaExpired",
      stage: "mfa",
      recovery: { action: "loginAgain" },
    };
  }
  if (id.includes("rate-limited")) {
    return {
      code: "rateLimited",
      stage,
      recovery: { action: "retry", afterMs: null },
    };
  }
  if (id.includes("disabled") || id.includes("unavailable")) {
    return {
      code: "capabilityUnavailable",
      stage,
      recovery: { action: "useLocalMode" },
    };
  }
  if (id.includes("expired")) {
    return {
      code: id.startsWith("password-reset")
        ? "externalIntentExpired"
        : "verificationExpired",
      stage,
      recovery: id.startsWith("password-reset")
        ? { action: "requestNewLink" }
        : { action: "requestNewCode", afterMs: null },
    };
  }
  if (id.includes("state-mismatch")) {
    return {
      code: "oauthStateMismatch",
      stage: "oauth",
      recovery: { action: "loginAgain" },
    };
  }
  if (id.includes("denied")) {
    return {
      code: "oauthDenied",
      stage: "oauth",
      recovery: { action: "retry", afterMs: null },
    };
  }
  return {
    code: "unknownSafeFailure",
    stage,
    recovery: { action: "useLocalMode" },
  };
}

export function cancelledFailureV1(
  operation: GatewayOperationNameV1,
): GatewayResultV1<never> {
  return {
    ok: false,
    error: {
      code: "cancelled",
      stage: stageForOperationV1(operation),
      recovery: { action: "none" },
    },
  };
}
