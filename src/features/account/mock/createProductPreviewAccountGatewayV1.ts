import type {
  AccountGatewayEventV1,
  AccountGatewayV1,
  AccountCenterViewV1,
  AccountSessionViewV1,
  AuthNextViewV1,
  ConfigurationTaskViewV1,
  GatewayResultV1,
  OAuthAttemptViewV1,
} from "../contracts";
import { ACCOUNT_CAPABILITY_KEYS_V1 } from "../contracts";
import { safeLabelV1 } from "../contracts/safeValues";
import { createMockAccountGatewayV1 } from "./MockAccountGatewayV1";
import { successV1 } from "./mockGatewaySupportV1";
import { createScenarioRuntimeV1 } from "./ScenarioRuntimeV1";

function gatewayForScenarioV1(scenarioId: string) {
  const runtime = createScenarioRuntimeV1(scenarioId);
  if (!runtime.ok) {
    throw new Error(`Missing Account product preview scenario: ${scenarioId}`);
  }
  return createMockAccountGatewayV1(runtime.value);
}

function enabledPreviewCapabilitiesV1() {
  const enabled = new Set([
    "auth.emailPasswordLogin",
    "auth.registration",
    "auth.passwordReset",
    "auth.oauth.github",
    "account.profile",
    "account.passwordChange",
    "account.revokeAllSessions",
    "usage.quotaPull",
    "managedKey.listCandidates",
    "managedKey.selectExisting",
    "managedKey.provision",
    "managedKey.rotate",
    "managedKey.revoke",
    "configuration.plan",
    "configuration.apply",
    "recipe.codex.v1",
  ]);
  return Object.fromEntries(
    ACCOUNT_CAPABILITY_KEYS_V1.map((key) => [
      key,
      enabled.has(key)
        ? { status: "enabled" as const }
        : { status: "disabled" as const, reason: "serverDisabled" as const },
    ]),
  );
}

const PREVIEW_PROFILE_LABEL_V1 = "Doge";
const PREVIEW_EMAIL_LABEL_V1 = "已验证邮箱";

function previewSessionV1(
  session: Extract<AccountSessionViewV1, { status: "authenticated" }>,
): Extract<AccountSessionViewV1, { status: "authenticated" }> {
  return {
    ...session,
    profileLabel: PREVIEW_PROFILE_LABEL_V1,
    primaryEmailLabel: PREVIEW_EMAIL_LABEL_V1,
  };
}

function previewAccountCenterV1(value: AccountCenterViewV1): AccountCenterViewV1 {
  return {
    ...value,
    profile: {
      ...value.profile,
      displayName: safeLabelV1(PREVIEW_PROFILE_LABEL_V1, "profileDisplayName"),
      primaryEmailLabel: safeLabelV1(
        PREVIEW_EMAIL_LABEL_V1,
        "primaryEmailLabel",
      ),
    },
  };
}

/**
 * Build-only M0 composition. The visible surface is the real product journey;
 * deterministic scenarios stay behind the Gateway instead of becoming UI.
 */
export function createProductPreviewAccountGatewayV1(): AccountGatewayV1 {
  const bootstrapGateway = gatewayForScenarioV1("login.happy");
  const registrationGateway = gatewayForScenarioV1("register.direct-success");
  const oauthGateway = gatewayForScenarioV1("oauth.happy-return");
  const resetGateway = gatewayForScenarioV1("password-reset.request-and-return");
  const configurationGateway = gatewayForScenarioV1("configuration.no-config-success");
  let session: AccountSessionViewV1 = { status: "signedOut" };
  let configurationTask: ConfigurationTaskViewV1 = { status: "none" };

  const rememberAuth = async (
    resultPromise: Promise<GatewayResultV1<AuthNextViewV1>>,
  ): Promise<GatewayResultV1<AuthNextViewV1>> => {
    const result = await resultPromise;
    if (result.ok && result.value.next === "authenticated") {
      const previewSession = previewSessionV1(result.value.session);
      session = previewSession;
      return {
        ...result,
        value: { ...result.value, session: previewSession },
      };
    }
    return result;
  };

  const rememberOAuth = async (
    resultPromise: Promise<GatewayResultV1<OAuthAttemptViewV1>>,
  ): Promise<GatewayResultV1<OAuthAttemptViewV1>> => {
    const result = await resultPromise;
    if (result.ok && result.value.status === "authenticated") {
      const previewSession = previewSessionV1(result.value.session);
      session = previewSession;
      return {
        ...result,
        value: { ...result.value, session: previewSession },
      };
    }
    return result;
  };

  return {
    contract: bootstrapGateway.contract,
    bootstrap: async (context) => {
      const result = await bootstrapGateway.bootstrap(context);
      if (!result.ok) return result;
      return {
        ...result,
        value: {
          ...result.value,
          session,
          capabilities: {
            ...result.value.capabilities,
            entries: enabledPreviewCapabilitiesV1(),
            registration: {
              emailSuffixHint: null,
              invitationCode: "hidden",
              promoCode: "hidden",
              agreementRequired: false,
              humanVerificationRequired: false,
            },
          },
        },
      };
    },
    reconcileIntent: (input) => Promise.resolve(successV1({
      status: "knownTerminal" as const,
      operation: input.expected,
      outcome: "succeeded" as const,
    })),
    subscribe: (listener: (event: AccountGatewayEventV1) => void) => {
      const unsubscribeOAuth = oauthGateway.subscribe(listener);
      const unsubscribeReset = resetGateway.subscribe(listener);
      return () => {
        unsubscribeOAuth();
        unsubscribeReset();
      };
    },
    humanVerification: bootstrapGateway.humanVerification,
    auth: {
      beginRegistration: (input, context) =>
        rememberAuth(registrationGateway.auth.beginRegistration(input, context)),
      resendRegistrationCode: registrationGateway.auth.resendRegistrationCode,
      submitRegistrationCode: (input, context) =>
        rememberAuth(registrationGateway.auth.submitRegistrationCode(input, context)),
      login: (input, context) =>
        rememberAuth(gatewayForScenarioV1("login.happy").auth.login(input, context)),
      verifyMfa: (input, context) =>
        rememberAuth(bootstrapGateway.auth.verifyMfa(input, context)),
      startOAuth: oauthGateway.auth.startOAuth,
      cancelOAuth: oauthGateway.auth.cancelOAuth,
      readOAuthAttempt: (input, context) =>
        rememberOAuth(oauthGateway.auth.readOAuthAttempt(input, context)),
      completeOAuthAccount: (input, context) =>
        rememberAuth(oauthGateway.auth.completeOAuthAccount(input, context)),
      requestPasswordReset: resetGateway.auth.requestPasswordReset,
      inspectExternalIntent: resetGateway.auth.inspectExternalIntent,
      resetPassword: resetGateway.auth.resetPassword,
      logout: async (input, context) => {
        const result = await gatewayForScenarioV1(
          "session.logout-remote-unconfirmed",
        ).auth.logout(input, context);
        if (result.ok) session = { status: "signedOut" };
        return result;
      },
    },
    profile: {
      read: async (context) => {
        const result = await gatewayForScenarioV1(
          "account.profile-update-happy",
        ).profile.read(context);
        return result.ok
          ? successV1(previewAccountCenterV1(result.value))
          : result;
      },
      updateProfile: async (input, context) => {
        const gateway = gatewayForScenarioV1("account.profile-update-happy");
        const current = await gateway.profile.read({});
        if (!current.ok) return current;
        const result = await gateway.profile.updateProfile(input, context);
        if (!result.ok) return result;
        const value: AccountCenterViewV1 = {
          ...previewAccountCenterV1(result.value),
          profile: {
            ...result.value.profile,
            displayName: safeLabelV1(input.displayName, "profileDisplayName"),
            primaryEmailLabel: safeLabelV1(
              PREVIEW_EMAIL_LABEL_V1,
              "primaryEmailLabel",
            ),
          },
        };
        return successV1(value);
      },
      changePassword: async (input, context) => {
        const result = await gatewayForScenarioV1(
          "account.change-password-happy",
        ).profile.changePassword(input, context);
        if (result.ok) session = { status: "signedOut" };
        return result;
      },
      requestTotpEmailCode: bootstrapGateway.profile.requestTotpEmailCode,
      beginTotpEnrollment: bootstrapGateway.profile.beginTotpEnrollment,
      confirmTotpEnrollment: bootstrapGateway.profile.confirmTotpEnrollment,
      disableTotp: bootstrapGateway.profile.disableTotp,
      startIdentityBinding: bootstrapGateway.profile.startIdentityBinding,
      unbindIdentity: bootstrapGateway.profile.unbindIdentity,
      revokeAllSessions: (input, context) =>
        gatewayForScenarioV1("session.revoke-all-confirmed").profile.revokeAllSessions(input, context),
    },
    usage: {
      read: (context) =>
        gatewayForScenarioV1("usage.fresh-normal").usage.read(context),
    },
    managedKey: {
      readStatus: configurationGateway.managedKey.readStatus,
      listCandidates: configurationGateway.managedKey.listCandidates,
      selectExisting: configurationGateway.managedKey.selectExisting,
      provision: configurationGateway.managedKey.provision,
      rotate: (input, context) =>
        gatewayForScenarioV1("managed-key.rotate").managedKey.rotate(input, context),
      revoke: (input, context) =>
        gatewayForScenarioV1("managed-key.revoke").managedKey.revoke(input, context),
    },
    configuration: {
      readOffer: async (context) => {
        const result = await configurationGateway.configuration.readOffer(context);
        if (result.ok) configurationTask = result.value;
        return result;
      },
      createPlan: async (input, context) => {
        const result = await configurationGateway.configuration.createPlan(input, context);
        if (result.ok) configurationTask = result.value;
        return result;
      },
      readFileDetail: configurationGateway.configuration.readFileDetail,
      apply: async (input, context) => {
        const result = await configurationGateway.configuration.apply(input, context);
        if (result.ok) configurationTask = result.value;
        return result;
      },
      readCurrentTask: () => Promise.resolve(successV1(configurationTask)),
      acknowledgeResult: () => {
        if ("result" in configurationTask) {
          configurationTask = { ...configurationTask, acknowledged: true };
        }
        return Promise.resolve(successV1({ acknowledged: true as const }));
      },
      hardDismiss: () => {
        configurationTask = { status: "none" };
        return Promise.resolve(successV1({ dismissed: true as const }));
      },
    },
  };
}

let productPreviewGatewayV1: AccountGatewayV1 | null = null;

export function getProductPreviewAccountGatewayV1(): AccountGatewayV1 {
  productPreviewGatewayV1 ??= createProductPreviewAccountGatewayV1();
  return productPreviewGatewayV1;
}

export function resetProductPreviewAccountGatewayV1ForTests(): void {
  productPreviewGatewayV1 = null;
}
