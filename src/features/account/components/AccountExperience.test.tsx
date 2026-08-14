// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountGatewayProvider } from "../gateway/AccountGatewayProvider";
import { createMockAccountGatewayV1 } from "../mock/MockAccountGatewayV1";
import { createScenarioRuntimeV1 } from "../mock/ScenarioRuntimeV1";
import { AccountExperience } from "./AccountExperience";
import { AccountConfigurationBubbleHost } from "./AccountConfigurationBubbleHost";
import { setAccountConfigurationBubbleVisibleV1 } from "../runtime/configurationBubbleStore";
import { createAccountCallContextV1 } from "../utils/accountFormValues";

const externalLinkMocks = vi.hoisted(() => ({
  openAccountExternalUrl: vi.fn(async () => undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

vi.mock("../../../services/accountExternalLinks", () => externalLinkMocks);

function renderScenarioV1(scenarioId: string) {
  const runtime = createScenarioRuntimeV1(scenarioId);
  if (!runtime.ok) throw new Error(`missing scenario ${scenarioId}`);
  const gateway = createMockAccountGatewayV1(runtime.value);
  return {
    gateway,
    runtime: runtime.value,
    ...render(
      <AccountGatewayProvider gateway={gateway}>
        <AccountExperience />
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
});

afterEach(() => {
  setAccountConfigurationBubbleVisibleV1(false);
  vi.restoreAllMocks();
});

describe("AccountExperience", () => {
  it("keeps Local Mode visible on the signed-out login surface", async () => {
    renderScenarioV1("login.happy");
    expect(await screen.findByText("本地模式始终可用")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Doge 账号" })).toBeTruthy();
    expect(screen.queryByText(/登录后可快捷接入/)).toBeNull();
    const localModeHelp = screen.getByRole("button", {
      name: "查看说明：本地模式始终可用",
    });
    expect(localModeHelp).toBeTruthy();
    expect(screen.getByRole("tab", { name: "登录" })).toBeTruthy();

    fireEvent.focus(localModeHelp);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-popup"]')?.textContent).toContain(
        "不登录也可以完整使用 Doge。本页提供的是额外便利功能。",
      );
    });
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
        <AccountExperience />
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
        <AccountExperience />
      </AccountGatewayProvider>,
    );

    expect(await screen.findByText("账号服务暂时不可用")).toBeTruthy();
    const helpButton = screen.getByRole("button", {
      name: "查看说明：账号服务暂时不可用",
    });
    expect(helpButton).toBeTruthy();
    expect(screen.queryByText("这不会影响 Doge 的任何本地功能。你可以稍后再试。")).toBeNull();
    expect(screen.getByText("本地模式始终可用")).toBeTruthy();
    expect(screen.queryByLabelText("邮箱")).toBeNull();
    expect(screen.queryByLabelText("密码")).toBeNull();

    await act(async () => {
      fireEvent.pointerMove(helpButton);
      fireEvent.mouseEnter(helpButton);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-popup"]')?.textContent).toContain(
        "这不会影响 Doge 的任何本地功能。你可以稍后再试。",
      );
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

  it("does not read quota until the user opens the quota tab", async () => {
    const { gateway } = renderScenarioV1("usage.fresh-normal");
    const usageRead = vi.spyOn(gateway.usage, "read");
    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
    expect(usageRead).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "额度" }));
    });
    await waitFor(() => expect(usageRead).toHaveBeenCalledTimes(1));
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
        <AccountExperience />
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
        <AccountExperience />
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

  it("updates profile through the security surface", async () => {
    const { gateway } = renderScenarioV1("account.profile-update-happy");
    const updateProfile = vi.spyOn(gateway.profile, "updateProfile");
    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "安全" }));
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
    expect(await screen.findByText("账号资料已更新。")).toBeTruthy();
  });

  it("keeps password fields local, validates confirmation, and signs out after change", async () => {
    const { gateway } = renderScenarioV1("account.change-password-happy");
    const changePassword = vi.spyOn(gateway.profile, "changePassword");
    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "安全" }));
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
