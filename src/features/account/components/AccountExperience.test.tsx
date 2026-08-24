// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountGatewayProvider } from "../gateway/AccountGatewayProvider";
import { createMockAccountGatewayV1 } from "../mock/MockAccountGatewayV1";
import { createScenarioRuntimeV1 } from "../mock/ScenarioRuntimeV1";
import { AccountExperience } from "./AccountExperience";
import { AccountConfigurationBubbleHost } from "./AccountConfigurationBubbleHost";
import { setAccountConfigurationBubbleVisibleV1 } from "../runtime/configurationBubbleStore";
import {
  clearProductEntitlementV1,
  publishProductReadyV1,
} from "../runtime/productEntitlementStore";
import { createAccountCallContextV1 } from "../utils/accountFormValues";

const externalLinkMocks = vi.hoisted(() => ({
  openAccountExternalUrl: vi.fn(async () => undefined),
}));
const productDetailMocks = vi.hoisted(() => ({
  readUsage: vi.fn(),
  readBilling: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

vi.mock("../../../services/accountExternalLinks", () => externalLinkMocks);
vi.mock("../../../services/accountProductCommands", () => ({
  readAccountProductUsageV1: productDetailMocks.readUsage,
  readAccountProductBillingV1: productDetailMocks.readBilling,
}));

function renderScenarioV1(scenarioId: string) {
  const runtime = createScenarioRuntimeV1(scenarioId);
  if (!runtime.ok) throw new Error(`missing scenario ${scenarioId}`);
  const gateway = createMockAccountGatewayV1(runtime.value);
  return {
    gateway,
    runtime: runtime.value,
    ...render(
      <AccountGatewayProvider gateway={gateway}>
        <AccountExperience showLegacyConfiguration />
        <AccountConfigurationBubbleHost
          onOpenAccount={() => undefined}
          onHardDismiss={async () => {
            const result = await gateway.configuration.hardDismiss(
              { recipeId: "doge.account.codex-token-service", recipeVersion: 1 },
              createAccountCallContextV1(),
            );
            return result.ok;
          }}
        />
      </AccountGatewayProvider>,
    ),
  };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(1_893_456_000_000);
  externalLinkMocks.openAccountExternalUrl.mockClear();
  productDetailMocks.readUsage.mockReset();
  productDetailMocks.readBilling.mockReset();
  productDetailMocks.readUsage.mockReturnValue(new Promise(() => undefined));
  productDetailMocks.readBilling.mockReturnValue(new Promise(() => undefined));
  act(() => publishTestProductReady());
});

afterEach(() => {
  setAccountConfigurationBubbleVisibleV1(false);
  act(() => clearProductEntitlementV1());
  vi.restoreAllMocks();
});

describe("AccountExperience", () => {
  it("keeps the signed-out surface focused on authentication", async () => {
    renderScenarioV1("login.happy");
    expect(await screen.findByRole("heading", { name: "Doge 账号" })).toBeTruthy();
    expect(screen.queryByText(/登录后可快捷接入/)).toBeNull();
    expect(screen.queryByText("本地模式始终可用")).toBeNull();
    expect(screen.getByRole("tab", { name: "登录" })).toBeTruthy();
  });

  it("keeps password recovery inside login instead of adding a third tab", async () => {
    const runtime = createScenarioRuntimeV1("login.happy");
    if (!runtime.ok) throw new Error("missing login scenario");
    const gateway = createMockAccountGatewayV1(runtime.value);
    const originalBootstrap = gateway.bootstrap;
    vi.spyOn(gateway, "bootstrap").mockImplementation(async (context) => {
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
              "auth.registration": { status: "enabled" as const },
              "auth.passwordReset": { status: "enabled" as const },
            },
          },
        },
      };
    });
    render(
      <AccountGatewayProvider gateway={gateway}>
        <AccountExperience showLegacyConfiguration />
      </AccountGatewayProvider>,
    );

    expect(await screen.findByRole("tab", { name: "登录" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "注册" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "找回密码" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "找回密码" }));
    expect(await screen.findByRole("heading", { name: "找回密码" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送找回邮件" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("tab", { name: "登录" })).toBeTruthy();
  });

  it("does not render a credential form when every remote auth capability is disabled", async () => {
    const runtime = createScenarioRuntimeV1("login.happy");
    if (!runtime.ok) throw new Error("missing login scenario");
    const gateway = createMockAccountGatewayV1(runtime.value);
    const originalBootstrap = gateway.bootstrap;
    vi.spyOn(gateway, "bootstrap").mockImplementation(async (context) => {
      const result = await originalBootstrap(context);
      if (!result.ok) return result;
      return {
        ...result,
        value: {
          ...result.value,
          capabilities: {
            ...result.value.capabilities,
            entries: Object.fromEntries(
              Object.entries(result.value.capabilities.entries).map(([key, value]) => [
                key,
                key.startsWith("auth.")
                  ? { status: "disabled" as const, reason: "serverGuaranteeMissing" as const }
                  : value,
              ]),
            ),
          },
        },
      };
    });
    render(
      <AccountGatewayProvider gateway={gateway}>
        <AccountExperience showLegacyConfiguration />
      </AccountGatewayProvider>,
    );

    expect(await screen.findByText("账号服务暂时不可用")).toBeTruthy();
    const helpButton = screen.getByRole("button", {
      name: "查看错误详情",
    });
    expect(helpButton).toBeTruthy();
    expect(screen.queryByText("请检查网络连接，或稍后重试。")).toBeNull();
    expect(screen.queryByText("本地模式始终可用")).toBeNull();
    expect(screen.queryByLabelText("邮箱")).toBeNull();
    expect(screen.queryByLabelText("密码")).toBeNull();

    await act(async () => {
      fireEvent.pointerMove(helpButton);
      fireEvent.mouseEnter(helpButton);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-popup"]')?.textContent).toContain(
        "查看错误详情",
      );
    });
  });

  it("reveals and hides safe multiline bootstrap diagnostics from the help trigger", async () => {
    const user = userEvent.setup();
    renderScenarioV1("bootstrap.offline");
    const detailsButton = await screen.findByRole("button", { name: "查看错误详情" });

    expect(detailsButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "账号服务错误详情" })).toBeNull();

    await user.tab();
    expect(document.activeElement).toBe(detailsButton);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-popup"]')?.textContent).toContain(
        "查看错误详情",
      );
    });
    await user.keyboard("{Enter}");

    const details = await screen.findByRole("region", { name: "账号服务错误详情" });
    expect(screen.getByRole("button", { name: "收起错误详情" }).getAttribute("aria-expanded"))
      .toBe("true");
    expect(details.textContent).toContain("请检查网络连接，或稍后重试。");
    expect(within(details).getByText("错误代码")).toBeTruthy();
    expect(within(details).getByText("offline")).toBeTruthy();
    expect(within(details).getByText("capabilities")).toBeTruthy();
    expect(within(details).getByText("useLocalMode")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "收起错误详情" }));
    expect(screen.queryByRole("region", { name: "账号服务错误详情" })).toBeNull();
    expect(screen.getByRole("button", { name: "查看错误详情" }).getAttribute("aria-expanded"))
      .toBe("false");
    await user.tab();
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-popup"]')).toBeNull();
    });
  });

  it("makes an unavailable bootstrap retry observable from start to completion", async () => {
    const { gateway } = renderScenarioV1("bootstrap.offline");
    const retryButton = await screen.findByRole("button", { name: "重试" });
    const originalBootstrap = gateway.bootstrap;
    const retryResult = await originalBootstrap({});
    let resolveRetry: ((result: typeof retryResult) => void) | null = null;
    vi.spyOn(gateway, "bootstrap").mockImplementationOnce(() => new Promise((resolve) => {
      resolveRetry = resolve;
    }));

    fireEvent.click(retryButton);
    expect((await screen.findByRole("button", {
      name: "正在重试",
    }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveRetry?.(retryResult);
    });
    expect((await screen.findByRole("button", {
      name: "再次重试",
    }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits login with form-local credentials and reaches the account center", async () => {
    renderScenarioV1("login.happy");
    await screen.findByRole("heading", { name: "Doge 账号" });
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "user@example.invalid" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "synthetic-password" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
    });
    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
    expect(screen.queryByDisplayValue("synthetic-password")).toBeNull();
  });

  it("loads profile but skips legacy API-key configuration reads in the product account center", async () => {
    const runtime = createScenarioRuntimeV1("session.cold-restore");
    if (!runtime.ok) throw new Error("missing session scenario");
    const gateway = createMockAccountGatewayV1(runtime.value);
    const profileRead = vi.spyOn(gateway.profile, "read");
    const keyStatusRead = vi.spyOn(gateway.managedKey, "readStatus");
    const keyCandidatesRead = vi.spyOn(gateway.managedKey, "listCandidates");
    render(
      <AccountGatewayProvider gateway={gateway}>
        <AccountExperience />
      </AccountGatewayProvider>,
    );

    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
    await waitFor(() => expect(profileRead).toHaveBeenCalledTimes(1));
    expect(keyStatusRead).not.toHaveBeenCalled();
    expect(keyCandidatesRead).not.toHaveBeenCalled();
  });

  it("buffers an early recovery event and resets the password inside Doge", async () => {
    const { gateway } = renderScenarioV1("password-reset.request-and-return");
    const inspectIntent = vi.spyOn(gateway.auth, "inspectExternalIntent");
    const resetPassword = vi.spyOn(gateway.auth, "resetPassword");
    expect(await screen.findByRole("heading", { name: "找回密码" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "找回密码" })).toBeNull();
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "user@example.invalid" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送找回邮件" }));
    });
    await waitFor(() => expect(inspectIntent).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "设置新密码" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "synthetic-new-password" },
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "synthetic-new-password" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    });
    await waitFor(() => expect(resetPassword).toHaveBeenCalledTimes(1));
    expect(screen.queryByDisplayValue("synthetic-new-password")).toBeNull();
    expect(await screen.findByText("密码已修改，请重新登录。")).toBeTruthy();
  });

  it("finishes an OAuth bind-confirmation inside Doge", async () => {
    const { gateway } = renderScenarioV1("oauth.completion-bind-confirmation");
    const complete = vi.spyOn(gateway.auth, "completeOAuthAccount");
    expect(await screen.findByText("GitHub")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    });
    expect(await screen.findByRole("heading", { name: "在浏览器中继续" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "我已完成授权" }));
    });
    expect(await screen.findByRole("heading", { name: "完成账号接入" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", {
      name: "我确认将这个登录方式绑定到当前账号",
    }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "继续" }));
    });
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
  });

  it("continues an OAuth account completion through MFA", async () => {
    const { gateway } = renderScenarioV1("oauth.completion-mfa");
    const verifyMfa = vi.spyOn(gateway.auth, "verifyMfa");
    const githubButton = await screen.findByRole("button", { name: "GitHub" });
    await act(async () => {
      fireEvent.click(githubButton);
    });
    const checkButton = await screen.findByRole("button", { name: "我已完成授权" });
    await act(async () => {
      fireEvent.click(checkButton);
    });
    expect(await screen.findByRole("heading", { name: "完成账号接入" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "继续" }));
    });
    expect(await screen.findByRole("heading", { name: "两步验证" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "654321" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "验证" }));
    });
    await waitFor(() => expect(verifyMfa).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
  });

  it("keeps a returned reset intent retryable after an offline read", async () => {
    const { gateway } = renderScenarioV1("password-reset.request-and-return");
    const inspectIntent = vi.spyOn(gateway.auth, "inspectExternalIntent");
    inspectIntent.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "offline",
        stage: "reset",
        recovery: { action: "useLocalMode" },
      },
    });
    expect(await screen.findByRole("heading", { name: "找回密码" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "user@example.invalid" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送找回邮件" }));
    });
    expect(await screen.findByRole("button", { name: "重试打开找回链接" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试打开找回链接" }));
    });
    await waitFor(() => expect(inspectIntent).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: "设置新密码" })).toBeTruthy();
  });

  it("loads product usage and billing without calling the legacy engine-scoped usage gateway", async () => {
    const currentUsage = deferredValue<ReturnType<typeof productUsageEnvelope>>();
    const previousUsage = deferredValue<ReturnType<typeof productUsageEnvelope>>();
    const billing = deferredValue<ReturnType<typeof productBillingEnvelope>>();
    productDetailMocks.readUsage.mockImplementation((period: "current" | "previous") =>
      period === "current" ? currentUsage.promise : previousUsage.promise);
    productDetailMocks.readBilling.mockReturnValue(billing.promise);
    const { gateway, container } = renderScenarioV1("usage.fresh-normal");
    const legacyUsageRead = vi.spyOn(gateway.usage, "read");

    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "账号与订阅" })).toBeTruthy();
    await waitFor(() => expect(productDetailMocks.readUsage).toHaveBeenCalledWith("current"));
    await waitFor(() => expect(productDetailMocks.readBilling).toHaveBeenCalledTimes(1));
    await act(async () => {
      currentUsage.resolve(productUsageEnvelope("current"));
      billing.resolve(productBillingEnvelope());
      await Promise.all([currentUsage.promise, billing.promise]);
    });
    expect(legacyUsageRead).not.toHaveBeenCalled();
    expect(container.querySelector(".account-usage-stat-grid")).toBeTruthy();
    expect(screen.getByText(/暂未记录 Doge 的运行引擎/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "上期" }));
    await waitFor(() => expect(productDetailMocks.readUsage).toHaveBeenCalledWith("previous"));
    await act(async () => {
      previousUsage.resolve(productUsageEnvelope("previous"));
      await previousUsage.promise;
    });
    expect(screen.queryByRole("tab", { name: "订阅" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "额度" })).toBeNull();
  });

  it("lists files before lazily loading safe change details", async () => {
    const { gateway } = renderScenarioV1("configuration.no-config-success");
    const readFileDetail = vi.spyOn(gateway.configuration, "readFileDetail");
    expect(await screen.findByRole("heading", { name: "选择 API Key" })).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Codex Key/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "使用此 API Key" }));
    });
    expect(await screen.findByText("将修改的文件")).toBeTruthy();
    expect(readFileDetail).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Codex 配置/ }));
    });
    await waitFor(() => expect(readFileDetail).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("修改前")).toBeTruthy();
    expect(screen.getAllByText("已安全隐藏").length).toBeGreaterThan(0);
    expect(screen.getByText("已存入系统凭据库")).toBeTruthy();
  });

  it("opens Token Matrix key management when the account has no API Key", async () => {
    const runtime = createScenarioRuntimeV1("configuration.no-config-success");
    if (!runtime.ok) throw new Error("missing configuration scenario");
    const gateway = createMockAccountGatewayV1(runtime.value);
    const originalListCandidates = gateway.managedKey.listCandidates;
    vi.spyOn(gateway.managedKey, "listCandidates").mockImplementation(async (input, context) => {
      const result = await originalListCandidates(input, context);
      if (!result.ok) return result;
      return { ...result, value: { ...result.value, keys: [] } };
    });
    render(
      <AccountGatewayProvider gateway={gateway}>
        <AccountExperience showLegacyConfiguration />
      </AccountGatewayProvider>,
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("radio")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "刷新" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /前往 Token Matrix/ }));
    });
    expect(externalLinkMocks.openAccountExternalUrl).toHaveBeenCalledWith(
      "https://token-matrix.com/keys",
    );
  });

  it("offers Token Matrix when existing API Keys are not selectable", async () => {
    const runtime = createScenarioRuntimeV1("configuration.no-config-success");
    if (!runtime.ok) throw new Error("missing configuration scenario");
    const gateway = createMockAccountGatewayV1(runtime.value);
    const originalListCandidates = gateway.managedKey.listCandidates;
    vi.spyOn(gateway.managedKey, "listCandidates").mockImplementation(async (input, context) => {
      const result = await originalListCandidates(input, context);
      if (!result.ok) return result;
      return {
        ...result,
        value: {
          ...result.value,
          keys: result.value.keys.map((candidate) => ({
            ...candidate,
            status: "disabled" as const,
            availability: "handoffUnavailable" as const,
          })),
        },
      };
    });
    render(
      <AccountGatewayProvider gateway={gateway}>
        <AccountExperience showLegacyConfiguration />
      </AccountGatewayProvider>,
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio").hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByRole("button", { name: /前往 Token Matrix/ })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "使用此 API Key" })).toBeNull();
  });

  it("focuses the ordinary close action when the configuration dialog opens", async () => {
    renderScenarioV1("configuration.no-config-success");
    const ordinaryClose = await screen.findByRole("button", { name: "稍后处理" });
    await waitFor(() => expect(document.activeElement).toBe(ordinaryClose));
    expect(
      screen.getByRole("button", { name: "查看说明：选择 API Key" })
        .getAttribute("data-state"),
    ).toBe("closed");
  });

  it("ordinary close leaves a reopenable Doge bubble and bubble x hard-dismisses", async () => {
    const { gateway } = renderScenarioV1("configuration.healthy-manual-preserve");
    const hardDismiss = vi.spyOn(gateway.configuration, "hardDismiss");
    expect(await screen.findByRole("heading", { name: "选择 API Key" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "稍后处理" }));
    expect(screen.getByRole("button", { name: "重新打开 Codex 配置" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新打开 Codex 配置" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "稍后处理" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "不再提示 Codex 配置" }));
    });
    await waitFor(() => expect(hardDismiss).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "重新打开 Codex 配置" })).toBeNull();
  });

  it("updates profile in the account header and keeps low-frequency security in its own action", async () => {
    const { gateway } = renderScenarioV1("account.profile-update-happy");
    const updateProfile = vi.spyOn(gateway.profile, "updateProfile");
    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    fireEvent.change(screen.getByLabelText("显示名称"), {
      target: { value: "Doge User" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "保存资料" }));
    });
    expect(updateProfile).toHaveBeenCalledWith(
      { displayName: "Doge User" },
      expect.objectContaining({ intent: expect.any(String) }),
    );
    expect(screen.getByRole("heading", { name: "Doge User" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "安全" })).toBeNull();
    expect(screen.queryByRole("button", { name: "安全" })).toBeNull();
  });

  it("keeps logout-all reachable from the generic security overflow", async () => {
    const { gateway } = renderScenarioV1("session.revoke-all-confirmed");
    const logout = vi.spyOn(gateway.auth, "logout");
    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();

    const overflow = await screen.findByRole("button", { name: "安全" });
    expect(screen.queryByRole("tab", { name: "安全" })).toBeNull();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeTruthy();
    fireEvent.click(overflow);

    fireEvent.click(
      await screen.findByRole("button", { name: "退出所有设备" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "退出所有设备？" }),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "退出所有设备" }),
    );
    await waitFor(() =>
      expect(logout).toHaveBeenCalledWith(
        { scope: "allSessions" },
        expect.objectContaining({ intent: expect.any(String) }),
      ),
    );
  });

  it("keeps managed-key revoke reachable from the security overflow", async () => {
    const runtime = createScenarioRuntimeV1("managed-key.revoke");
    if (!runtime.ok) throw new Error("missing managed-key revoke scenario");
    const gateway = createMockAccountGatewayV1(runtime.value);
    vi.spyOn(gateway.managedKey, "readStatus").mockResolvedValue({
      ok: true,
      value: {
        status: "ready",
        recipeId: "doge.account.codex-token-service",
        recipeVersion: 1,
      },
    });
    const revoke = vi.spyOn(gateway.managedKey, "revoke");
    render(
      <AccountGatewayProvider gateway={gateway}>
        <AccountExperience showLegacyConfiguration />
      </AccountGatewayProvider>,
    );

    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "安全" }));
    fireEvent.click(await screen.findByRole("button", { name: "移除 API Key" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "移除 Codex API Key？" }),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "撤销凭据" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
  });

  it("keeps password fields local, validates confirmation, and signs out after change", async () => {
    const { gateway } = renderScenarioV1("account.change-password-happy");
    const changePassword = vi.spyOn(gateway.profile, "changePassword");
    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "修改密码" }));
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "修改密码并重新登录" }));
    expect(await screen.findByText("两次输入的新密码不一致。")).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "修改密码并重新登录" }));
    });
    expect(changePassword).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Doge 账号" })).toBeTruthy();
    expect(screen.queryByDisplayValue("old-password")).toBeNull();
    expect(screen.queryByDisplayValue("new-password")).toBeNull();
  });
});

function publishTestProductReady(): void {
  publishProductReadyV1({
    entitlement: {
      status: "active",
      subscriptionId: 9,
      groupId: 5,
      groupName: "Doge",
      planName: "Doge Pro",
      expiresAt: "2030-02-01T00:00:00Z",
      usage: {
        daily: { usedUsd: 1, limitUsd: 10, percentage: 10 },
        weekly: { usedUsd: 2, limitUsd: 20, percentage: 10 },
        monthly: { usedUsd: 3, limitUsd: 30, percentage: 10 },
      },
    },
    engines: [
      { id: "codex", displayName: "Codex" },
      { id: "claude-code", displayName: "Claude" },
      { id: "kimi", displayName: "Kimi" },
    ],
    models: [{
      id: "gpt-5.6-sol",
      displayName: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      compatibleEngines: ["codex"],
      capabilities: ["chat"],
    }],
  });
}

function productUsageEnvelope(period: "current" | "previous") {
  return {
    ok: true,
    value: {
      period,
      fetched_at: "2030-01-10T12:00:00Z",
      range: {
        query_start_date: period === "current" ? "2030-01-02" : "2029-12-03",
        query_end_date: period === "current" ? "2030-01-10" : "2030-01-01",
        period_start_date: period === "current" ? "2030-01-02" : "2029-12-03",
        period_end_date: period === "current" ? "2030-01-31" : "2030-01-01",
        resets_at: period === "current" ? "2030-02-01T00:00:00Z" : null,
        source: "subscriptionMonthly",
      },
      totals: {
        requests: 7,
        input_tokens: 100,
        output_tokens: 20,
        cache_tokens: 10,
        total_tokens: 130,
        standard_cost_usd: 1.25,
        actual_cost_usd: 1,
        average_duration_ms: 7200,
      },
      quota: period === "current" ? {
        used_usd: 1,
        limit_usd: 10,
        percentage: 10,
        resets_at: "2030-02-01T00:00:00Z",
      } : null,
      engine_breakdown_status: "unsupported",
      models_status: "available",
      models: [{
        id: "gpt-5.6-sol",
        display_name: "gpt-5.6-sol",
        requests: 5,
        total_tokens: 100,
        standard_cost_usd: 1,
        actual_cost_usd: 0.8,
      }],
    },
  };
}

function productBillingEnvelope() {
  return {
    ok: true,
    value: {
      fetched_at: "2030-01-10T12:00:00Z",
      invoice_download_status: "unsupported",
      orders: [{
        id: 91,
        plan_name: "Doge Pro",
        occurred_at: "2030-01-01T00:01:00Z",
        amount: 86.4,
        currency: "CNY",
        status: "paid",
        invoice_available: false,
      }],
    },
  };
}

function deferredValue<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
