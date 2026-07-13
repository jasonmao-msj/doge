// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGlossaryMatcher } from "../../plugins/glossary";
import { __setGlossaryMatcherForTests } from "../../plugins/glossaryStore";
import { Markdown } from "./Markdown";

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
            { term: "部署", explanation: "把程序搬到服务器上运行。" },
            { term: "API", explanation: "应用之间的服务窗口。" },
          ],
        },
      },
    ]),
  );
}

describe("Markdown glossary integration", () => {
  afterEach(() => {
    __setGlossaryMatcherForTests(null);
    cleanup();
  });

  it("wraps known terms into clickable glossary chips through the full pipeline", async () => {
    seedMatcher();
    const value = "先调用 API，再执行部署。代码里的 `API` 不标注。";

    const { container } = render(
      <Markdown value={value} className="markdown" />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".glossary-term-chip")).toHaveLength(2);
    });
    const chips = [...container.querySelectorAll(".glossary-term-chip")].map(
      (node) => node.textContent,
    );
    expect(chips).toEqual(["API", "部署"]);
    // 行内代码里的 API 不被标注
    expect(container.querySelector("code")?.textContent).toBe("API");
    expect(container.querySelector("code .glossary-term-chip")).toBeNull();
  });

  it("renders plain markdown untouched when no glossary is installed", async () => {
    __setGlossaryMatcherForTests(null);
    const { container } = render(
      <Markdown value="先调用 API，再执行部署。" className="markdown" />,
    );

    await waitFor(() => {
      expect(container.querySelector("p")).toBeTruthy();
    });
    expect(container.querySelector(".glossary-term-chip")).toBeNull();
  });
});
