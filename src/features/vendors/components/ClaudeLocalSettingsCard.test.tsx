// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "../types";
import { LOCAL_SETTINGS_PROVIDER_ID } from "../types";
import { ClaudeLocalSettingsCard } from "./ClaudeLocalSettingsCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function localProvider(options: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: LOCAL_SETTINGS_PROVIDER_ID,
    name: "Local settings",
    isLocalProvider: true,
    ...options,
  };
}

function renderCard(
  provider: ProviderConfig | null,
  overrides: Partial<Parameters<typeof ClaudeLocalSettingsCard>[0]> = {},
) {
  const props = {
    localProvider: provider,
    inUse: false,
    onSwitch: vi.fn(),
    onEdit: vi.fn(),
    ...overrides,
  };
  const view = render(<ClaudeLocalSettingsCard {...props} />);
  return { ...view, props };
}

afterEach(() => {
  cleanup();
});

describe("ClaudeLocalSettingsCard", () => {
  it("renders nothing without a local provider", () => {
    const { container } = renderCard(null);

    expect(container.firstChild).toBeNull();
  });

  it("shows the in-use badge without revoke when official is effective", () => {
    renderCard(localProvider(), { inUse: true });

    expect(screen.getByText("settings.vendor.officialConfig")).toBeTruthy();
    expect(
      screen.queryByText("settings.vendor.localProviderDescription"),
    ).toBeNull();
    expect(screen.getByText("settings.vendor.inUse")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: /settings\.vendor\.revokeAuthorization/,
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /settings\.vendor\.useOfficialConfig/,
      }),
    ).toBeNull();
  });

  it("shows Use without in-use when a third-party is active", () => {
    renderCard(localProvider({ isActive: false }), { inUse: false });

    expect(screen.queryByText("settings.vendor.inUse")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /settings\.vendor\.useOfficialConfig/,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: /settings\.vendor\.revokeAuthorization/,
      }),
    ).toBeNull();
  });

  it("switches to local settings on Use", () => {
    const { props } = renderCard(localProvider({ isActive: false }), {
      inUse: false,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /settings\.vendor\.useOfficialConfig/,
      }),
    );

    expect(props.onSwitch).toHaveBeenCalledWith(LOCAL_SETTINGS_PROVIDER_ID);
  });

  it("locks local activation for a product-managed session but keeps terminal config editable", () => {
    const { props, container } = renderCard(
      localProvider({ isActive: false }),
      {
        inUse: false,
        managedLock: {
          label: "Doge managed",
          description: "The app uses the isolated Doge profile.",
        },
      },
    );

    expect(
      container.querySelector('[data-managed-locked="true"]'),
    ).toBeTruthy();
    expect(screen.getByText("Doge managed")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: /settings\.vendor\.useOfficialConfig/,
      }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "settings.vendor.edit" }),
    );
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(props.onSwitch).not.toHaveBeenCalled();
  });

  it("surfaces local provider help in the row popover", async () => {
    renderCard(localProvider(), { inUse: true });

    fireEvent.click(screen.getByTitle("settings.vendor.whatIsThis"));

    expect(
      await screen.findByText("settings.vendor.localProviderDescription"),
    ).toBeTruthy();
    expect(
      screen.getByText("settings.vendor.localProviderHelpBody"),
    ).toBeTruthy();
    expect(document.querySelector(".vendor-dialog")).toBeNull();
  });

  it("forwards the edit action to onEdit", () => {
    const { props } = renderCard(localProvider(), { inUse: true });

    fireEvent.click(screen.getByTitle("settings.vendor.edit"));

    expect(props.onEdit).toHaveBeenCalledTimes(1);
  });
});
