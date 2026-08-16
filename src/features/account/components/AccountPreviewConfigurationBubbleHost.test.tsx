// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProductPreviewAccountGatewayV1,
  resetProductPreviewAccountGatewayV1ForTests,
} from "../mock/createProductPreviewAccountGatewayV1";
import { setAccountConfigurationBubbleVisibleV1 } from "../runtime/configurationBubbleStore";
import { AccountPreviewConfigurationBubbleHost } from "./AccountPreviewConfigurationBubbleHost";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

describe("AccountPreviewConfigurationBubbleHost", () => {
  beforeEach(() => {
    resetProductPreviewAccountGatewayV1ForTests();
    setAccountConfigurationBubbleVisibleV1(false);
  });

  it("reuses the product preview Gateway and hard-dismisses the same task", async () => {
    const gateway = getProductPreviewAccountGatewayV1();
    await gateway.configuration.readOffer({});
    setAccountConfigurationBubbleVisibleV1(true);
    const onOpenAccount = vi.fn();
    render(<AccountPreviewConfigurationBubbleHost onOpenAccount={onOpenAccount} />);

    fireEvent.click(screen.getByRole("button", { name: "重新打开 Codex 配置" }));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);

    await act(async () => {
      setAccountConfigurationBubbleVisibleV1(true);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "不再提示 Codex 配置" }));
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "重新打开 Codex 配置" })).toBeNull();
    });
    expect(await gateway.configuration.readCurrentTask({})).toEqual({
      ok: true,
      value: { status: "none" },
    });
  });
});
