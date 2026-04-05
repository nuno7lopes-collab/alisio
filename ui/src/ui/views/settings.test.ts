/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderSettingsHub } from "./settings.ts";

function createProps(
  overrides: Partial<Parameters<typeof renderSettingsHub>[0]> = {},
): Parameters<typeof renderSettingsHub>[0] {
  return {
    section: "general",
    onSectionChange: vi.fn(),
    accountLoading: false,
    accountError: null,
    accountNotice: null,
    account: null,
    doctorLoading: false,
    doctorError: null,
    doctor: null,
    locale: "en",
    theme: "claw",
    themeMode: "system",
    borderRadius: 50,
    onLocaleChange: vi.fn(),
    onThemeChange: vi.fn(),
    onThemeModeChange: vi.fn(),
    onBorderRadiusChange: vi.fn(),
    onSaveAccountField: vi.fn(),
    nativeShellLoading: false,
    nativeShellError: null,
    nativeShellState: null,
    onRefreshNative: vi.fn(),
    onSetLaunchAtLogin: vi.fn(),
    onRequestPermission: vi.fn(),
    onSetVoiceWake: vi.fn(),
    onOpenNativeSettings: vi.fn(),
    onRevealLogs: vi.fn(),
    onOpenSetup: vi.fn(),
    onSignOutAccount: vi.fn(),
    onRequestPasswordReset: vi.fn(),
    onReconnectRuntime: vi.fn(),
    ...overrides,
  };
}

describe("renderSettingsHub", () => {
  it("renders only the published settings sections in the sidebar", () => {
    const container = document.createElement("div");

    render(renderSettingsHub(createProps()), container);

    const labels = Array.from(
      container.querySelectorAll<HTMLElement>(".alisio-settings-link__label"),
    ).map((element) => element.textContent?.trim() ?? "");

    expect(labels).toEqual(["General", "Account", "Mac", "Support"]);
    expect(container.textContent).not.toContain("AI");
  });

  it("renders the compact general controls with the public language options", () => {
    const container = document.createElement("div");

    render(renderSettingsHub(createProps()), container);

    const select = container.querySelector<HTMLSelectElement>(
      ".alisio-settings-field--inline select",
    );
    const options = Array.from(select?.querySelectorAll("option") ?? []).map(
      (option) => option.textContent?.trim() ?? "",
    );

    expect(container.textContent).toContain("Theme");
    expect(container.textContent).toContain("Language");
    expect(container.textContent).toContain("Claw");
    expect(container.textContent).toContain("Knot");
    expect(container.textContent).toContain("Dash");
    expect(options).toEqual(["English", "Portuguese (Portugal)", "Spanish"]);
  });

  it("wires theme family, mode, and roundness controls through the general section", () => {
    const container = document.createElement("div");
    const onThemeChange = vi.fn();
    const onThemeModeChange = vi.fn();
    const onBorderRadiusChange = vi.fn();

    render(
      renderSettingsHub(
        createProps({
          onThemeChange,
          onThemeModeChange,
          onBorderRadiusChange,
        }),
      ),
      container,
    );

    container.querySelector<HTMLElement>('[data-theme-option="knot"]')?.click();
    container.querySelector<HTMLElement>('[data-theme-mode="light"]')?.click();
    container.querySelector<HTMLElement>('[data-radius-option="75"]')?.click();

    expect(onThemeChange.mock.calls[0]?.[0]).toBe("knot");
    expect(onThemeModeChange).toHaveBeenCalledWith("light");
    expect(onBorderRadiusChange).toHaveBeenCalledWith(75);
  });
});
