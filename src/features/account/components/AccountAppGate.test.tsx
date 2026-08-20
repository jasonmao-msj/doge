// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAccountGatewayV1 } from "../mock/MockAccountGatewayV1";
import { createScenarioRuntimeV1 } from "../mock/ScenarioRuntimeV1";
import type { AccountGatewayEventV1, AccountGatewayV1 } from "../contracts";
import type { AccountEngineOnboardingClientV1 } from "../runtime/engineOnboardingClient";
import { writeLastManagedEnginePreferenceV1 } from "../runtime/enginePreference";
import {
  clearManagedEngineEntitlementsV1,
  readManagedEnginePreparationV1,
} from "../runtime/engineEntitlementStore";
import {
  requestAccountEngineSwitchV1,
  subscribeAccountEngineReadyV1,
} from "../runtime/engineSwitchSignal";
import { AccountAppGate } from "./AccountAppGate";
import { resolveAccountEngineToolchainV1 } from "../../../services/accountEngineCommands";
import { resetClientStorageForTests } from "../../../services/clientStorage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

const activateProviderMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../vendors/activateEngineProviderProfile", () => ({
  activateEngineProviderProfileAndNotify: activateProviderMock,
}));

vi.mock("../../../services/accountEngineCommands", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../services/accountEngineCommands")>(),
  resolveAccountEngineToolchainV1: vi.fn(async (engineId: "codex" | "claude-code") => ({
    ok: true,
    value: {
      engineId,
      status: "ready",
      bundledVersion: engineId === "codex" ? "0.147.0" : "2.1.233",
      externalVersion: null,
      selectedSource: "bundled",
    },
  })),
}));

beforeEach(() => {
  localStorage.clear();
  resetClientStorageForTests();
  clearManagedEngineEntitlementsV1();
  activateProviderMock.mockReset();
  activateProviderMock.mockResolvedValue(undefined);
  vi.mocked(resolveAccountEngineToolchainV1).mockImplementation(async (engineId) => ({
    ok: true,
    value: {
      engineId,
      status: "ready",
      bundledVersion: engineId === "codex" ? "0.147.0" : "2.1.233",
      externalVersion: null,
      selectedSource: "bundled",
    },
  }));
});
afterEach(() => vi.useRealTimers());

describe("AccountAppGate", () => {
  it("activates the engine before the managed provider and marks preparation last", async () => {
    const client = engineClient({ codexEntitled: true });
    const sequence: string[] = [];
    const activateEngine = vi.fn(async () => {
      sequence.push("engine");
    });
    activateProviderMock.mockImplementation(async () => {
      sequence.push("provider");
    });

    render(
      <AccountAppGate
        gateway={authenticatedGateway()}
        engineClient={client}
        engineActivator={activateEngine}
        readyContent={<div>主应用已挂载</div>}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    expect(await screen.findByText("主应用已挂载")).toBeTruthy();
    expect(sequence).toEqual(["engine", "provider"]);
    expect(activateProviderMock).toHaveBeenCalledWith("codex", "doge-token-matrix");
    expect(readManagedEnginePreparationV1().codex).toBe("prepared");
  });

  it("does not mark preparation when managed provider activation fails", async () => {
    const client = engineClient({ codexEntitled: true });
    activateProviderMock.mockRejectedValueOnce(new Error("provider unavailable"));

    render(
      <AccountAppGate
        gateway={authenticatedGateway()}
        engineClient={client}
        engineActivator={async () => undefined}
        readyContent={<div>主应用已挂载</div>}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    expect(await screen.findByRole("heading", { name: "准备没有完成" })).toBeTruthy();
    expect(screen.queryByText("主应用已挂载")).toBeNull();
    expect(readManagedEnginePreparationV1().codex).toBe("unprepared");
  });

  it("asks once before using a bundled version newer than the user's engine", async () => {
    const client = engineClient({ codexEntitled: true });
    vi.mocked(resolveAccountEngineToolchainV1).mockImplementation(async (engineId, choice) => ({
      ok: true,
      value: choice === null
        ? {
            engineId,
            status: "choiceRequired",
            bundledVersion: "0.147.0",
            externalVersion: "0.146.0",
            selectedSource: null,
          }
        : {
            engineId,
            status: "ready",
            bundledVersion: "0.147.0",
            externalVersion: "0.146.0",
            selectedSource: choice,
          },
    }));
    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);

    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    expect(await screen.findByRole("heading", { name: "使用哪个 Codex 版本？" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "使用 Doge 新版 0.147.0" }));

    expect(await screen.findByText("主应用已挂载")).toBeTruthy();
    expect(resolveAccountEngineToolchainV1).toHaveBeenLastCalledWith("codex", "bundled");
    expect(client.prepare).toHaveBeenCalledWith("codex");
  });

  it("does not mount the app before an entitled engine is ready", async () => {
    const client = engineClient({ codexEntitled: true });
    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);

    expect(screen.queryByText("主应用已挂载")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByText("主应用已挂载")).toBeTruthy();
    expect(client.prepare).toHaveBeenCalledWith("codex");
  });

  it("shows exactly the server plans when the engine has no entitlement", async () => {
    const client = engineClient({ codexEntitled: false });
    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);

    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByRole("button", { name: /Starter/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pro/ })).toBeTruthy();
    expect(screen.queryByText(/充值|按量|API Key/i)).toBeNull();
    expect(screen.queryByText("主应用已挂载")).toBeNull();
  });

  it("titles a QR checkout with Doge and the authoritative plan name", async () => {
    const client = engineClient({ codexEntitled: false });
    vi.mocked(client.checkout).mockResolvedValue({
      ok: true,
      value: {
        checkoutId: 77,
        status: "pending",
        expiresAt: "2030-01-01T00:00:00Z",
        planName: null,
        action: { kind: "show_qr", url: null, data: "alipay://payment/opaque" },
      },
    });
    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Pro/ }));

    expect(await screen.findByRole("heading", { name: "Doge Pro" })).toBeTruthy();
  });

  it("lets a user without a subscription sign out from the plan gate", async () => {
    const client = engineClient({ codexEntitled: false });
    const gateway = authenticatedGateway();
    const logout = vi.spyOn(gateway.auth, "logout").mockResolvedValue({
      ok: true,
      value: { localSessionCleared: true, remoteRevocation: "unconfirmed" },
    });
    render(<AccountAppGate gateway={gateway} engineClient={client} engineActivator={async () => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    expect(await screen.findByRole("button", { name: /Starter/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => expect(logout).toHaveBeenCalledWith(
      { scope: "thisDevice" },
      expect.any(Object),
    ));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Starter/ })).toBeNull());
  });

  it("settles on login when logout races with a session bootstrap", async () => {
    const client = engineClient({ codexEntitled: false });
    const { gateway, settleLogout, settleEventBootstrap } = logoutBootstrapRaceGateway();
    render(<AccountAppGate gateway={gateway} engineClient={client} engineActivator={async () => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    expect(await screen.findByRole("button", { name: /Starter/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(await screen.findByText("正在连接")).toBeTruthy();
    act(() => settleLogout());
    await act(async () => Promise.resolve());
    expect(screen.queryByText("正在连接")).toBeNull();
    expect(screen.getByRole("tab", { name: "登录" })).toBeTruthy();
    await act(async () => settleEventBootstrap());
    expect(screen.getByRole("tab", { name: "登录" })).toBeTruthy();
  });

  it("keeps the plan gate recoverable and blocks duplicate sign-out submissions", async () => {
    const client = engineClient({ codexEntitled: false });
    const gateway = authenticatedGateway();
    type LogoutResult = Awaited<ReturnType<AccountGatewayV1["auth"]["logout"]>>;
    let settleLogout: (result: LogoutResult) => void = () => undefined;
    const pendingLogout = new Promise<LogoutResult>((resolve) => { settleLogout = resolve; });
    const logout = vi.spyOn(gateway.auth, "logout").mockReturnValue(pendingLogout);
    render(<AccountAppGate gateway={gateway} engineClient={client} engineActivator={async () => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    expect(await screen.findByRole("button", { name: /Starter/ })).toBeTruthy();
    const logoutButton = screen.getByRole("button", { name: "退出登录" }) as HTMLButtonElement;

    fireEvent.click(logoutButton);
    await waitFor(() => expect(logoutButton.disabled).toBe(true));
    fireEvent.click(logoutButton);
    expect(logout).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleLogout({
        ok: false,
        error: {
          code: "serviceUnavailable",
          stage: "logout",
          recovery: { action: "retry", afterMs: null },
        },
      });
      await pendingLogout;
    });

    expect((await screen.findByRole("alert")).textContent).toContain("服务暂时不可用");
    expect(screen.getByRole("button", { name: /Starter/ })).toBeTruthy();
    expect(logoutButton.disabled).toBe(false);
  });

  it("signs out from catalog recovery without opening a stale checkout", async () => {
    const client = engineClient({ codexEntitled: false });
    vi.mocked(openUrl).mockClear();
    type ResumeResult = Awaited<ReturnType<AccountEngineOnboardingClientV1["resumeCheckout"]>>;
    let settleResume: (result: ResumeResult) => void = () => undefined;
    const pendingResume = new Promise<ResumeResult>((resolve) => { settleResume = resolve; });
    vi.mocked(client.resumeCheckout).mockReturnValue(pendingResume);
    const gateway = authenticatedGateway();
    const logout = vi.spyOn(gateway.auth, "logout").mockResolvedValue({
      ok: true,
      value: { localSessionCleared: true, remoteRevocation: "unconfirmed" },
    });
    render(<AccountAppGate gateway={gateway} engineClient={client} engineActivator={async () => undefined} />);

    await waitFor(() => expect(client.resumeCheckout).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "退出登录" }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull());

    await act(async () => {
      settleResume({
        ok: true,
        value: {
          engineId: "codex",
          checkout: {
            checkoutId: 91,
            status: "pending",
            expiresAt: "2030-01-01T00:00:00Z",
            planName: null,
            action: { kind: "open_url", url: "https://token-matrix.com/pay/91", data: null },
          },
        },
      });
      await pendingResume;
    });

    expect(openUrl).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Codex/ })).toBeNull();
  });

  it("automatically prepares after a paid checkout receipt", async () => {
    const client = engineClient({ codexEntitled: false });
    vi.mocked(client.readCheckout).mockResolvedValue({
      ok: true,
      value: { checkoutId: 77, status: "paid", expiresAt: "2030-01-01T00:00:00Z", planName: null, action: null },
    });
    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);
    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    const planButton = await screen.findByRole("button", { name: /Starter/ });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(planButton);
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText("主应用已挂载")).toBeTruthy());
    expect(client.prepare).toHaveBeenCalledWith("codex");
  });

  it("keeps the current app mounted when a second-engine purchase is cancelled", async () => {
    const client = engineClient({ codexEntitled: true });
    writeLastManagedEnginePreferenceV1("codex");
    render(
      <AccountAppGate
        gateway={authenticatedGateway()}
        engineClient={client}
        engineActivator={async () => undefined}
        readyContent={<div data-testid="ready-app">主应用已挂载</div>}
      />,
    );

    const readyApp = await screen.findByTestId("ready-app");
    act(() => requestAccountEngineSwitchV1({
      source: "enginePicker",
      targetEngineId: "claude-code",
      openNewConversation: true,
    }));

    expect(await screen.findByRole("heading", { name: "选择 Claude 套餐" })).toBeTruthy();
    expect(screen.getByTestId("ready-app")).toBe(readyApp);
    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "选择 Claude 套餐" })).toBeNull());
    expect(screen.getByTestId("ready-app")).toBe(readyApp);
    expect(client.prepare).not.toHaveBeenCalledWith("claude-code");
  });

  it("completes Codex ready to Claude paid preparation without remounting the app", async () => {
    const client = engineClient({ codexEntitled: true });
    const activateEngine = vi.fn(async () => undefined);
    const readyIntent = vi.fn();
    const unsubscribe = subscribeAccountEngineReadyV1(readyIntent);
    writeLastManagedEnginePreferenceV1("codex");
    vi.mocked(client.readCheckout).mockResolvedValue({
      ok: true,
      value: {
        checkoutId: 77,
        status: "paid",
        expiresAt: "2030-01-01T00:00:00Z",
        planName: null,
        action: null,
      },
    });
    render(
      <AccountAppGate
        gateway={authenticatedGateway()}
        engineClient={client}
        engineActivator={activateEngine}
        readyContent={<div data-testid="ready-app">主应用已挂载</div>}
      />,
    );

    const readyApp = await screen.findByTestId("ready-app");
    act(() => requestAccountEngineSwitchV1({
      source: "enginePicker",
      targetEngineId: "claude-code",
      openNewConversation: true,
    }));
    expect(await screen.findByRole("heading", { name: "选择 Claude 套餐" })).toBeTruthy();
    expect(client.plans).toHaveBeenCalledWith("claude-code");

    const planButton = await screen.findByRole("button", { name: /Starter/ });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(planButton);
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    vi.useRealTimers();

    await waitFor(() => expect(readyIntent).toHaveBeenCalledWith({
      engineId: "claude-code",
      openNewConversation: true,
    }));
    expect(client.prepare).toHaveBeenCalledWith("claude-code");
    expect(activateEngine).toHaveBeenLastCalledWith("claude-code");
    expect(screen.getByTestId("ready-app")).toBe(readyApp);
    unsubscribe();
  });

  it("restores a durable pending checkout before offering another plan", async () => {
    const client = engineClient({ codexEntitled: false });
    vi.mocked(client.resumeCheckout).mockResolvedValue({
      ok: true,
      value: {
        engineId: "codex",
        checkout: {
          checkoutId: 88,
          status: "pending",
          expiresAt: "2030-01-01T00:00:00Z",
          planName: null,
          action: { kind: "open_url", url: "https://token-matrix.com/pay/88", data: null },
        },
      },
    });

    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);

    expect(await screen.findByText("等待完成支付")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新打开支付" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "返回套餐" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
    expect(client.plans).not.toHaveBeenCalled();
    expect(screen.queryByText("主应用已挂载")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回套餐" }));

    await waitFor(() => expect(client.abandonCheckout).toHaveBeenCalledWith(88));
    expect(client.plans).toHaveBeenCalledWith("codex");
    expect(await screen.findByRole("button", { name: /Starter/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "退出登录" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("leaves a recovered checkout by signing out", async () => {
    const client = engineClient({ codexEntitled: false });
    vi.mocked(client.resumeCheckout).mockResolvedValue({
      ok: true,
      value: {
        engineId: "codex",
        checkout: {
          checkoutId: 88,
          status: "pending",
          expiresAt: "2030-01-01T00:00:00Z",
          planName: null,
          action: null,
        },
      },
    });
    const gateway = authenticatedGateway();
    const logout = vi.spyOn(gateway.auth, "logout").mockResolvedValue({
      ok: true,
      value: { localSessionCleared: true, remoteRevocation: "unconfirmed" },
    });

    render(<AccountAppGate gateway={gateway} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);
    expect(await screen.findByText("等待完成支付")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "退出登录" }));

    await waitFor(() => expect(logout).toHaveBeenCalledWith(
      { scope: "thisDevice" },
      expect.any(Object),
    ));
    await waitFor(() => expect(screen.queryByText("等待完成支付")).toBeNull());
  });

  it("keeps checkout recovery visible when the local checkpoint cannot be abandoned", async () => {
    const client = engineClient({ codexEntitled: false });
    vi.mocked(client.resumeCheckout).mockResolvedValue({
      ok: true,
      value: {
        engineId: "codex",
        checkout: {
          checkoutId: 88,
          status: "pending",
          expiresAt: "2030-01-01T00:00:00Z",
          planName: null,
          action: null,
        },
      },
    });
    vi.mocked(client.abandonCheckout).mockResolvedValue({
      ok: false,
      error: { code: "persistenceUnavailable" },
    });

    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "返回套餐" }));

    await waitFor(() => expect(client.abandonCheckout).toHaveBeenCalledWith(88));
    expect(client.plans).not.toHaveBeenCalled();
    expect(screen.getByText("等待完成支付")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("removes the app immediately when the account session signs out", async () => {
    const { gateway, expireSession } = expiringGateway();
    const client = engineClient({ codexEntitled: true });
    writeLastManagedEnginePreferenceV1("codex");
    render(<AccountAppGate gateway={gateway} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);

    expect(await screen.findByText("主应用已挂载")).toBeTruthy();

    act(() => expireSession());

    await waitFor(() => expect(screen.queryByText("主应用已挂载")).toBeNull());
  });
});

function expiringGateway(): {
  readonly gateway: AccountGatewayV1;
  readonly expireSession: () => void;
} {
  const base = authenticatedGateway();
  const originalBootstrap = base.bootstrap.bind(base);
  let expired = false;
  let listener: ((event: AccountGatewayEventV1) => void) | null = null;
  const gateway = Object.create(base) as AccountGatewayV1;
  gateway.bootstrap = async (context) => {
    const result = await originalBootstrap(context);
    if (!result.ok || !expired) return result;
    return { ...result, value: { ...result.value, session: { status: "signedOut" } } };
  };
  gateway.subscribe = (next) => {
    listener = next;
    return () => { listener = null; };
  };
  return {
    gateway,
    expireSession: () => {
      expired = true;
      if (!listener) throw new Error("account event listener is unavailable");
      listener({
        kind: "sessionChanged",
        eventId: "event_test_session_expired_0001",
        emittedAt: "2030-01-01T00:00:00Z",
        processGeneration: 1,
        eventSeq: 1,
        accountEpoch: 2,
      });
    },
  };
}

function logoutBootstrapRaceGateway(): {
  readonly gateway: AccountGatewayV1;
  readonly settleLogout: () => void;
  readonly settleEventBootstrap: () => Promise<void>;
} {
  const base = authenticatedGateway();
  const originalBootstrap = base.bootstrap.bind(base);
  type BootstrapResult = Awaited<ReturnType<AccountGatewayV1["bootstrap"]>>;
  type LogoutResult = Awaited<ReturnType<AccountGatewayV1["auth"]["logout"]>>;
  let bootstrapCalls = 0;
  let listener: ((event: AccountGatewayEventV1) => void) | null = null;
  let resolveEventBootstrap: (result: BootstrapResult) => void = () => undefined;
  const eventBootstrap = new Promise<BootstrapResult>((resolve) => {
    resolveEventBootstrap = resolve;
  });
  let resolveLogout: (result: LogoutResult) => void = () => undefined;
  const logoutResult = new Promise<LogoutResult>((resolve) => {
    resolveLogout = resolve;
  });
  const bootstrapWithAuth = async (context: Parameters<AccountGatewayV1["bootstrap"]>[0]) => {
    const result = await originalBootstrap(context);
    if (!result.ok) return result;
    return {
      ...result,
      value: {
        ...result.value,
        capabilities: {
          ...result.value.capabilities,
          entries: {
            ...result.value.capabilities.entries,
            "auth.emailPasswordLogin": { status: "enabled" as const },
            "auth.registration": { status: "enabled" as const },
          },
        },
      },
    };
  };
  const gateway = Object.create(base) as AccountGatewayV1;
  gateway.bootstrap = (context) => {
    bootstrapCalls += 1;
    return bootstrapCalls === 1 ? bootstrapWithAuth(context) : eventBootstrap;
  };
  gateway.subscribe = (next) => {
    listener = next;
    return () => { listener = null; };
  };
  gateway.auth.logout = vi.fn(() => {
    if (!listener) throw new Error("account event listener is unavailable");
    listener({
      kind: "sessionChanged",
      eventId: "event_test_logout_race_0001",
      emittedAt: "2030-01-01T00:00:00Z",
      processGeneration: 1,
      eventSeq: 1,
      accountEpoch: 2,
    });
    return logoutResult;
  });
  return {
    gateway,
    settleLogout: () => resolveLogout({
      ok: true,
      value: { localSessionCleared: true, remoteRevocation: "unconfirmed" },
    }),
    settleEventBootstrap: async () => {
      resolveEventBootstrap(await bootstrapWithAuth({}));
      await eventBootstrap;
    },
  };
}

function authenticatedGateway() {
  const runtime = createScenarioRuntimeV1("session.cold-restore");
  if (!runtime.ok) throw new Error("missing session scenario");
  return createMockAccountGatewayV1(runtime.value);
}

function engineClient({ codexEntitled }: { readonly codexEntitled: boolean }): AccountEngineOnboardingClientV1 {
  return {
    catalog: vi.fn(async () => ({
      ok: true as const,
      value: [
        { id: "codex" as const, displayName: "Codex", entitlement: { status: codexEntitled ? "active" as const : "none" as const, expiresAt: null } },
        { id: "claude-code" as const, displayName: "Claude", entitlement: { status: "none" as const, expiresAt: null } },
      ],
    })),
    plans: vi.fn(async (engineId) => ({
      ok: true as const,
      value: {
        engineId,
        plans: [plan(1, "Starter", 9), plan(2, "Pro", 29)],
        paymentMethods: [{ id: "alipay", displayName: "支付宝", currency: "CNY" }],
      },
    })),
    readiness: vi.fn(async (engineId) => ({ ok: true as const, value: { engineId, status: "ready" as const } })),
    checkout: vi.fn(async () => ({
      ok: true as const,
      value: {
        checkoutId: 77,
        status: "pending" as const,
        expiresAt: "2030-01-01T00:00:00Z",
        planName: null,
        action: { kind: "open_url" as const, url: "https://token-matrix.com/pay/77", data: null },
      },
    })),
    readCheckout: vi.fn(async () => ({
      ok: true as const,
      value: { checkoutId: 77, status: "pending" as const, expiresAt: "2030-01-01T00:00:00Z", planName: null, action: null },
    })),
    resumeCheckout: vi.fn(async () => ({ ok: true as const, value: null })),
    abandonCheckout: vi.fn(async () => ({ ok: true as const, value: null })),
    prepare: vi.fn(async (engineId) => ({ ok: true as const, value: { engineId, status: "ready" as const } })),
  };
}

function plan(id: number, name: string, price: number) {
  return {
    id,
    name,
    description: "",
    price,
    originalPrice: null,
    currency: "CNY",
    validityDays: 30,
    validityUnit: "day",
    features: [],
    dailyLimitUsd: null,
    weeklyLimitUsd: null,
    monthlyLimitUsd: null,
  };
}
