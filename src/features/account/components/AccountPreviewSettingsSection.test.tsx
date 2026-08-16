// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetProductPreviewAccountGatewayV1ForTests } from "../mock/createProductPreviewAccountGatewayV1";
import { AccountPreviewSettingsSection } from "./AccountPreviewSettingsSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

describe("AccountPreviewSettingsSection", () => {
  beforeEach(() => {
    resetProductPreviewAccountGatewayV1ForTests();
  });

  it("shows the product journey without exposing scenario controls", async () => {
    render(<AccountPreviewSettingsSection />);
    expect(await screen.findByRole("tab", { name: "登录" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "注册" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "找回密码" })).toBeNull();
    expect(screen.getByRole("button", { name: "找回密码" })).toBeTruthy();
    expect(screen.queryByText("交互预览")).toBeNull();
    expect(screen.queryByLabelText("体验场景")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "注册" }));
    });
    expect(screen.getByRole("button", { name: "创建账号" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "user@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "synthetic-password" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "登录" }));
    });
    expect(await screen.findByRole("tab", { name: "概览" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "额度" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "安全" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /切换引擎/ })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("completes registration from the second primary tab", async () => {
    render(<AccountPreviewSettingsSection />);
    fireEvent.click(await screen.findByRole("tab", { name: "注册" }));
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "new-user@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "synthetic-password" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "创建账号" }));
    });
    expect(await screen.findByText("已连接 Token 服务")).toBeTruthy();
    expect(screen.getByRole("button", { name: /切换引擎/ })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("completes password recovery through the login page action", async () => {
    render(<AccountPreviewSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "找回密码" }));
    expect(screen.queryByRole("tab", { name: "找回密码" })).toBeNull();
    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "user@example.invalid" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送找回邮件" }));
    });
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
    expect(await screen.findByText("密码已修改，请重新登录。")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "登录" })).toBeTruthy();
  });
});
