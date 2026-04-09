/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderSettingsHub } from "./settings.ts";

function createAccount(): NonNullable<Parameters<typeof renderSettingsHub>[0]["account"]> {
  return {
    profile: {
      username: "nuno",
      displayName: "Nuno",
      email: "nuno@example.com",
      avatarLabel: "N",
      joinedAt: "2026-04-01T00:00:00.000Z",
      plan: "free",
    },
    preferences: {
      language: "en",
      theme: "dark",
    },
    session: {
      state: "signed_in",
      profileCompleted: true,
    },
    devices: [
      {
        id: "device-1",
        label: "Nuno's Mac",
        platform: "macOS",
        current: true,
        status: "active",
        lastSeenAt: "2026-04-05T10:00:00.000Z",
      },
    ],
    cloud: {
      backend: "supabase",
      available: true,
      missingEnvVars: [],
    },
  };
}

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
    onLocaleChange: vi.fn(),
    onThemeChange: vi.fn(),
    onThemeModeChange: vi.fn(),
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
    onRequestRecoveryEmail: vi.fn(),
    onChangeEmail: vi.fn(),
    onUpdatePassword: vi.fn(),
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
    expect(container.textContent).toContain("Amber");
    expect(container.textContent).toContain("Violet");
    expect(container.textContent).toContain("Bronze");
    expect(container.textContent).not.toContain("None");
    expect(container.textContent).not.toContain("Slight");
    expect(container.textContent).not.toContain("Default");
    expect(container.textContent).not.toContain("Full");
    expect(options).toEqual(["English", "Portuguese (Portugal)", "Spanish"]);
  });

  it("wires theme family and mode controls through the general section", () => {
    const container = document.createElement("div");
    const onThemeChange = vi.fn();
    const onThemeModeChange = vi.fn();

    render(
      renderSettingsHub(
        createProps({
          onThemeChange,
          onThemeModeChange,
        }),
      ),
      container,
    );

    container.querySelector<HTMLElement>('[data-theme-option="knot"]')?.click();
    container.querySelector<HTMLElement>('[data-theme-mode="light"]')?.click();

    expect(onThemeChange.mock.calls[0]?.[0]).toBe("knot");
    expect(onThemeModeChange).toHaveBeenCalledWith("light");
    expect(container.querySelectorAll("[data-radius-option]")).toHaveLength(0);
  });

  it("opens billing as a focused subsection with honest support CTA copy", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          section: "billing",
          account: createAccount(),
        }),
      ),
      container,
    );

    const cardTitles = Array.from(
      container.querySelectorAll<HTMLElement>(".alisio-settings-card .card-title"),
    ).map((element) => element.textContent?.trim() ?? "");

    expect(cardTitles[0]).toBe("Billing");
    expect(container.textContent).toContain("Current plan");
    expect(container.textContent).toContain("Contact support");
    expect(container.textContent).not.toContain("Upgrade plan");
    expect(container.querySelector('a[href^="mailto:support@alisio.pt"]')).not.toBeNull();
  });

  it("does not show a fake free-plan fallback while account data is still loading", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          section: "billing",
          accountLoading: true,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Billing");
    expect(container.textContent).not.toContain("Free Plan");
    expect(container.querySelector('a[href^="mailto:support@alisio.pt"]')).toBeNull();
  });

  it("renders the agent name field in the account section", () => {
    const container = document.createElement("div");
    const account = createAccount();
    account.profile.agentName = "Muse";

    render(
      renderSettingsHub(
        createProps({
          section: "account",
          account,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Agent name");
    expect(container.textContent).toContain("Muse");
    expect(container.textContent).toContain("Change email");
    expect(container.textContent).toContain("Update password");
  });

  it("hides the recovery action for Google accounts", () => {
    const container = document.createElement("div");
    const account = createAccount();
    account.session.authMethod = "google";

    render(
      renderSettingsHub(
        createProps({
          section: "account",
          account,
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("Send recovery email");
    expect(container.textContent).toContain("Sign out");
  });

  it("renders translated setup labels in doctor issues", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          doctor: {
            ok: false,
            bootstrap: {} as never,
            issues: [
              {
                code: "gateway_not_connected",
                severity: "error",
                title: "Alisio app not connected",
                message: "Open or reconnect the Alisio app before continuing setup.",
                step: "gateway",
              },
            ],
            checks: {
              gateway: false,
              runtime: true,
              account: true,
              organization: true,
              connectors: true,
              permissions: true,
            },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Alisio");
    expect(container.textContent).toContain("Reconnect Alisio");
    expect(container.textContent).not.toContain("gateway");
  });
});
