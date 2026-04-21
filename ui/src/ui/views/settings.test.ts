/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_SELECTION } from "../theme.ts";
import { renderSettingsHub } from "./settings.ts";

function createAccount(): NonNullable<Parameters<typeof renderSettingsHub>[0]["account"]> {
  return {
    accountId: "user-1",
    scopeRoot: "account",
    canonical: {
      scopeRoot: "account",
      accountId: "user-1",
      source: "account_id",
      authenticated: true,
      authRequired: true,
    },
    profile: {
      accountId: "user-1",
      username: "nuno",
      displayName: "Nuno",
      email: "nuno@example.com",
      avatarLabel: "N",
      joinedAt: "2026-04-01T00:00:00.000Z",
      plan: "free",
    },
    preferences: {
      language: "en",
      themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
      themeMode: "dark",
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
    },
    session: {
      state: "signed_in",
      profileCompleted: true,
      authRequired: true,
      authenticated: true,
      accountId: "user-1",
    },
    devices: [
      {
        id: "device-1",
        label: "Nuno's Mac",
        platform: "macOS",
        current: true,
        status: "active",
        lastSeenAt: "2026-04-05T10:00:00.000Z",
        accountId: "user-1",
        binding: "account_bound",
        runtime: "local",
      },
    ],
    cloud: {
      backend: "supabase",
      available: true,
      missingEnvVars: [],
    },
    deviceBinding: {
      binding: "account_bound",
      runtime: "local",
      current: true,
      accountId: "user-1",
      deviceId: "device-1",
      label: "Nuno's Mac",
      platform: "macOS",
    },
    runtimeContract: {
      scopeRoot: "account",
      backendShared: ["account", "auth", "linked_devices", "session_index", "automations"] as const,
      localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"] as const,
    },
  };
}

function createDoctor(
  overrides: Partial<NonNullable<Parameters<typeof renderSettingsHub>[0]["doctor"]>> = {},
): NonNullable<Parameters<typeof renderSettingsHub>[0]["doctor"]> {
  return {
    ok: true,
    bootstrap: {} as never,
    issues: [],
    checks: {
      gateway: true,
      runtime: true,
      account: true,
      organization: true,
      connectors: true,
      permissions: true,
    },
    ...overrides,
  };
}

function createNativeShellState(): NonNullable<
  Parameters<typeof renderSettingsHub>[0]["nativeShellState"]
> {
  return {
    platform: "macos",
    launchAtLogin: true,
    permissions: {
      notifications: true,
      appleScript: true,
      accessibility: false,
      screenRecording: false,
      microphone: true,
      speechRecognition: true,
      camera: false,
      location: false,
    },
    voiceWake: {
      supported: true,
      enabled: true,
      talkEnabled: false,
      triggers: ["alisio"],
    },
    logsPath: "/tmp/alisio.log",
    developerCheckoutAvailable: true,
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
    themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
    themeMode: "system",
    themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
    onLocaleChange: vi.fn(),
    onThemeFamilyChange: vi.fn(),
    onThemeAccentChange: vi.fn(),
    onThemeModeChange: vi.fn(),
    onResetPresentation: vi.fn(),
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
    nativeRebuildAvailable: false,
    nativeRebuildInFlight: false,
    nativeRebuildStatus: null,
    nativeRebuildError: null,
    onRebuildNativeApp: vi.fn(),
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

    expect(labels).toEqual(["General", "Account", "Support"]);
    expect(container.textContent).not.toContain("AI");
  });

  it("shows the Host section only when the current shell exposes host capabilities", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          nativeShellState: createNativeShellState(),
        }),
      ),
      container,
    );

    const labels = Array.from(
      container.querySelectorAll<HTMLElement>(".alisio-settings-link__label"),
    ).map((element) => element.textContent?.trim() ?? "");

    expect(labels).toEqual(["General", "Account", "Host", "Support"]);
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
    expect(container.textContent).toContain("Mood");
    expect(container.textContent).toContain("Noir");
    expect(container.textContent).toContain("Matte");
    expect(container.textContent).not.toContain("None");
    expect(container.textContent).not.toContain("Slight");
    expect(container.textContent).not.toContain("Default");
    expect(container.textContent).not.toContain("Full");
    expect(options).toEqual(["English", "Portuguese (Portugal)", "Spanish"]);
  });

  it("wires theme family and mode controls through the general section", () => {
    const container = document.createElement("div");
    const onThemeFamilyChange = vi.fn();
    const onThemeModeChange = vi.fn();

    render(
      renderSettingsHub(
        createProps({
          onThemeFamilyChange,
          onThemeModeChange,
        }),
      ),
      container,
    );

    container.querySelector<HTMLElement>('[data-theme-option="noir"]')?.click();
    container.querySelector<HTMLElement>('[data-theme-mode="light"]')?.click();

    expect(onThemeFamilyChange.mock.calls[0]?.[0]).toBe("noir");
    expect(onThemeModeChange).toHaveBeenCalledWith("light");
    expect(container.querySelectorAll("[data-radius-option]")).toHaveLength(0);
  });

  it("keeps the accent row outside label semantics so only the swatch stays interactive", () => {
    const container = document.createElement("div");

    render(renderSettingsHub(createProps()), container);

    const row = container.querySelector<HTMLElement>(".settings-theme-card__accent-row");
    const label = container.querySelector<HTMLElement>(".settings-theme-card__accent-label");
    const input = container.querySelector<HTMLInputElement>(".settings-theme-card__accent-input");

    expect(row?.tagName).toBe("DIV");
    expect(label?.closest("label")).toBeNull();
    expect(input?.closest("label")).toBeNull();
  });

  it("still routes accent changes through the swatch input", () => {
    const container = document.createElement("div");
    const onThemeAccentChange = vi.fn();

    render(
      renderSettingsHub(
        createProps({
          onThemeAccentChange,
        }),
      ),
      container,
    );

    const input = container.querySelector<HTMLInputElement>(
      ".settings-theme-card--mood .settings-theme-card__accent-input",
    );

    expect(input).not.toBeNull();

    if (!input) {
      return;
    }

    input.value = "#123456";
    input.dispatchEvent(new Event("change"));

    expect(onThemeAccentChange).toHaveBeenCalledWith("mood", "#123456");
  });

  it("renders a reset control for presentation defaults", () => {
    const container = document.createElement("div");
    const onResetPresentation = vi.fn();

    render(
      renderSettingsHub(
        createProps({
          onResetPresentation,
        }),
      ),
      container,
    );

    container.querySelector<HTMLElement>(".settings-appearance__reset")?.click();

    expect(onResetPresentation).toHaveBeenCalledTimes(1);
  });

  it("renders the shared empty state when the account has no linked computers", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          section: "account",
          account: {
            ...createAccount(),
            devices: [],
          },
        }),
      ),
      container,
    );

    const emptyState = container.querySelector(".empty-state--surface");
    expect(emptyState).not.toBeNull();
    expect(emptyState?.textContent).toContain("No linked computers yet");
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

  it("keeps account-derived cards visible while the account refresh is in flight", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          section: "account",
          accountLoading: true,
          account: createAccount(),
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Nuno's Mac");
    expect(container.textContent).toContain("Free Plan");
    expect(container.querySelectorAll(".loading-state__list-item")).toHaveLength(0);
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

  it("applies the shared username validation pattern in the account section", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          section: "account",
          account: createAccount(),
        }),
      ),
      container,
    );

    const usernameInput = container.querySelector<HTMLInputElement>(
      'input[autocomplete="username"]',
    );
    expect(usernameInput?.getAttribute("pattern")).toBe("^[A-Za-z0-9._]+$");
    expect(usernameInput?.getAttribute("autocapitalize")).toBe("off");
    expect(usernameInput?.getAttribute("spellcheck")).toBe("false");
  });

  it("keeps the Host controls visible while the native shell refresh is in flight", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          section: "host",
          nativeShellLoading: true,
          nativeShellState: createNativeShellState(),
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Launch at login");
    expect(container.textContent).toContain("/tmp/alisio.log");
    expect(container.querySelectorAll(".loading-state__list-item")).toHaveLength(0);
  });

  it("keeps current doctor details visible while health checks refresh", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          section: "host",
          doctorLoading: true,
          doctor: createDoctor({
            ok: false,
            issues: [
              {
                code: "gateway_unhealthy",
                severity: "error",
                title: "Runtime needs a restart",
                message: "Gateway probe failed.",
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
          }),
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Runtime needs a restart");
    expect(container.textContent).toContain("Reconnect Alisio");
    expect(container.querySelectorAll(".loading-state__list-item")).toHaveLength(0);
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

  it("does not show a temporary healthy doctor card while account sections refresh", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          section: "account",
          doctorLoading: true,
          doctor: createDoctor(),
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("System health");
    expect(container.querySelector(".alisio-settings-doctor")).toBeNull();
  });

  it("shows the sync action outside the Host section when a local checkout is available", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          section: "account",
          nativeRebuildAvailable: true,
          doctor: {
            ok: false,
            bootstrap: {} as never,
            issues: [
              {
                code: "gateway_unhealthy",
                severity: "error",
                title: "Runtime needs a restart",
                message: "Gateway probe failed.",
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

    expect(container.textContent).toContain("Sync app + UI");
    expect(container.textContent).not.toContain("Restart runtime");
  });

  it("prefers the sync action over runtime restart in the Host doctor state", () => {
    const container = document.createElement("div");

    render(
      renderSettingsHub(
        createProps({
          section: "host",
          nativeRebuildAvailable: true,
          doctor: {
            ok: false,
            bootstrap: {} as never,
            issues: [
              {
                code: "gateway_unhealthy",
                severity: "error",
                title: "Runtime needs a restart",
                message: "Gateway probe failed.",
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

    expect(container.textContent).toContain("Sync app + UI");
    expect(container.textContent).not.toContain("Restart runtime");
  });
});
