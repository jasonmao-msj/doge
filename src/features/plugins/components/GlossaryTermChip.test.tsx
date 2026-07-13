// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGlossaryMatcher } from "../glossary";
import { __setGlossaryMatcherForTests } from "../glossaryStore";
import { GlossaryTermChip } from "./GlossaryTermChip";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "pluginsPage.glossarySource"
        ? `来自插件：${options?.plugin}`
        : key,
  }),
}));

vi.mock("../../../services/tauri/plugins", () => ({
  readPluginGlossary: vi.fn(),
  listInstalledPlugins: vi.fn(async () => []),
}));

function seedMatcher() {
  __setGlossaryMatcherForTests(
    buildGlossaryMatcher([
      {
        pluginId: "tech-glossary",
        pluginName: "技术名词解释",
        document: {
          version: 1,
          terms: [
            {
              term: "API",
              aliases: ["接口"],
              explanation: "应用程序之间互相沟通的服务窗口。",
            },
          ],
        },
      },
    ]),
  );
}

describe("GlossaryTermChip", () => {
  afterEach(() => {
    __setGlossaryMatcherForTests(null);
  });

  it("falls back to plain text when the term is unknown", () => {
    __setGlossaryMatcherForTests(null);
    render(<GlossaryTermChip>未知词</GlossaryTermChip>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("未知词")).toBeTruthy();
  });

  it("shows the explanation popover on click", async () => {
    seedMatcher();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<GlossaryTermChip>API</GlossaryTermChip>);

    await user.click(screen.getByRole("button", { name: "API" }));

    await waitFor(() => {
      expect(screen.getByText("应用程序之间互相沟通的服务窗口。")).toBeTruthy();
    });
    expect(screen.getByText("来自插件：技术名词解释")).toBeTruthy();
  });

  it("resolves aliases to the canonical term in the popover title", async () => {
    seedMatcher();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<GlossaryTermChip>接口</GlossaryTermChip>);

    await user.click(screen.getByRole("button", { name: "接口" }));

    await waitFor(() => {
      // 弹层标题显示主词条 API
      expect(screen.getAllByText("API").length).toBeGreaterThan(0);
    });
  });
});
