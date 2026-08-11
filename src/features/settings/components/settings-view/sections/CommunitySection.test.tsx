// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DOGE_ISSUES_URL,
  DOGE_NAME,
  DOGE_REPOSITORY_URL,
} from "@/config/brand";
import { CommunitySection } from "./CommunitySection";

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "about.tagline": "doge tagline",
        "about.story": "doge AI Shiba story",
        "about.github": "GitHub",
        "about.reportIssue": "Report Issue",
      })[key] ?? key,
  }),
}));

describe("CommunitySection", () => {
  afterEach(() => {
    cleanup();
    mocks.openUrl.mockClear();
  });

  it("shows only doge-owned community surfaces", () => {
    render(<CommunitySection appVersion="0.1.0" />);

    expect(screen.getByText(DOGE_NAME)).toBeTruthy();
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("doge tagline")).toBeTruthy();
    expect(screen.getByText("doge AI Shiba story")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(document.body.textContent).not.toMatch(/WeChat|公众号|微信群/iu);
  });

  it("opens canonical doge repository and issue links", () => {
    render(<CommunitySection appVersion={null} />);

    fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
    fireEvent.click(screen.getByRole("button", { name: "Report Issue" }));

    expect(mocks.openUrl).toHaveBeenNthCalledWith(1, DOGE_REPOSITORY_URL);
    expect(mocks.openUrl).toHaveBeenNthCalledWith(2, DOGE_ISSUES_URL);
  });
});
