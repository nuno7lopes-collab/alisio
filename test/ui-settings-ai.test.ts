/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../ui/src/i18n/index.ts";
import type { AlisioBootstrapState } from "../ui/src/ui/types.ts";
import { renderSettingsHub } from "../ui/src/ui/views/settings.ts";

function createBootstrapAccount() {
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
      language: "en" as const,
      theme: "dark" as const,
    },
    session: {
      state: "signed_in" as const,
      profileCompleted: true,
    },
    devices: [],
  };
}

function createBootstrap(overrides: Partial<AlisioBootstrapState> = {}): AlisioBootstrapState {
  return {
    connectionRequired: false,
    wizardRequired: false,
    wizardRunning: false,
    providerReady: true,
    accountReady: true,
    startupState: "ready",
    organizationState: { mode: "none" },
    connectorSummary: {
      total: 0,
      ready: 0,
      connected: 0,
      needsReconnect: 0,
      inReview: 0,
      unavailable: 0,
      available: 0,
    },
    nextStep: "ready",
    account: createBootstrapAccount(),
    ai: {
      provider: "openai",
      status: "connected",
      activeProfileId: "team-profile",
      activeWorkerCredentialId: "cred-team",
      activeAuthProfileId: "openai-codex:team",
      binding: {
        workerId: "local:test-device",
        workerCredentialId: "cred-team",
        authProfileId: "openai-codex:team",
        boundAt: "2026-04-04T18:00:00.000Z",
      },
      profiles: [
        {
          profileId: "team-profile",
          label: "luciasalgueiro59@gmail.com",
          provider: "openai",
          scope: "user",
          ownerKey: "user:user-1",
          canonicalIdentityKey: "email:luciasalgueiro59@gmail.com",
          identity: {
            email: "luciasalgueiro59@gmail.com",
            canonicalIdentityKey: "email:luciasalgueiro59@gmail.com",
            source: "email",
          },
          status: "connected",
          email: "luciasalgueiro59@gmail.com",
          planLabel: "team",
          connectedAt: "2026-04-04T18:00:00.000Z",
          aggregatedTelemetry: {
            source: "official",
            planType: "team",
            observedAt: "2099-04-04T18:00:00.000Z",
            staleAt: "2099-04-04T18:10:00.000Z",
            primaryWindow: {
              label: "5h",
              durationMinutes: 300,
              usedPercent: 18,
              remainingPercent: 82,
            },
          },
          workerCredentials: [
            {
              workerCredentialId: "cred-team",
              workerId: "local:test-device",
              authProfileId: "openai-codex:team",
              runtimeState: "connected",
              email: "luciasalgueiro59@gmail.com",
              connectedAt: "2026-04-04T18:00:00.000Z",
              runtimeBound: true,
            },
          ],
        },
        {
          profileId: "personal-profile",
          label: "nl7nunolopes7@gmail.com",
          provider: "openai",
          scope: "user",
          ownerKey: "user:user-1",
          canonicalIdentityKey: "email:nl7nunolopes7@gmail.com",
          identity: {
            email: "nl7nunolopes7@gmail.com",
            canonicalIdentityKey: "email:nl7nunolopes7@gmail.com",
            source: "email",
          },
          status: "connected",
          email: "nl7nunolopes7@gmail.com",
          planLabel: "free",
          connectedAt: "2026-04-04T17:00:00.000Z",
          aggregatedTelemetry: {
            source: "official",
            planType: "free",
            observedAt: "2099-04-04T17:00:00.000Z",
            staleAt: "2099-04-04T17:10:00.000Z",
            primaryWindow: {
              label: "Week",
              durationMinutes: 10080,
              usedPercent: 0,
              remainingPercent: 100,
            },
          },
          workerCredentials: [
            {
              workerCredentialId: "cred-personal",
              workerId: "local:test-device",
              authProfileId: "openai-codex:personal",
              runtimeState: "connected",
              email: "nl7nunolopes7@gmail.com",
              connectedAt: "2026-04-04T17:00:00.000Z",
              runtimeBound: false,
            },
          ],
        },
      ],
    },
    organization: { mode: "none" },
    connectors: {
      catalog: [],
      authorizations: [],
      summary: {
        total: 0,
        ready: 0,
        connected: 0,
        needsReconnect: 0,
        inReview: 0,
        unavailable: 0,
        available: 0,
      },
    },
    wizard: { running: false, sessionId: null },
    models: { total: 0, defaultProvider: "openai", providers: [] },
    ...overrides,
  };
}

function renderAiSettings(
  overrides: Partial<Parameters<typeof renderSettingsHub>[0]> = {},
  bootstrap: AlisioBootstrapState = createBootstrap(),
) {
  const container = document.createElement("div");
  render(
    renderSettingsHub({
      section: "ai",
      onSectionChange: vi.fn(),
      accountLoading: false,
      accountError: null,
      accountNotice: null,
      account: bootstrap.account,
      bootstrap,
      aiLoading: false,
      aiError: null,
      doctorLoading: false,
      doctorError: null,
      doctor: null,
      locale: "en",
      themeMode: "dark",
      nativeShellLoading: false,
      nativeShellError: null,
      nativeShellState: null,
      onLocaleChange: vi.fn(),
      onThemeModeChange: vi.fn(),
      onSaveAccountField: vi.fn(),
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
      onConnectAi: vi.fn(),
      onDisconnectAi: vi.fn(),
      onRefreshAi: vi.fn(),
      onSelectAiProfile: vi.fn(),
      onDisconnectAiProfile: vi.fn(),
      onRefreshAiProfile: vi.fn(),
      onRenameAiProfile: vi.fn(),
      ...overrides,
    }),
    container,
  );
  return container;
}

describe("settings AI view", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("renders a single accounts surface and highlights the bound active account", () => {
    const container = renderAiSettings();

    expect(container.querySelector(".alisio-settings-ai__runtime")).toBeNull();
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>(".alisio-settings-ai__profile"),
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]?.classList.contains("is-active")).toBe(true);

    const title = cards[0]
      ?.querySelector(".alisio-settings-ai__profile-title")
      ?.textContent?.trim();
    const subtitle = cards[0]
      ?.querySelector(".alisio-settings-ai__profile-subtitle")
      ?.textContent?.trim();
    const meta = cards[0]?.querySelector(".alisio-settings-ai__profile-meta")?.textContent ?? "";

    expect(title).toBe("luciasalgueiro59@gmail.com");
    expect(subtitle).toBe("Team");
    expect(meta.toLowerCase()).not.toContain("team");
    expect(cards[0]?.textContent).toContain("Active");
    expect(
      cards[1]?.querySelector(".alisio-settings-ai__profile-subtitle")?.textContent?.trim(),
    ).toBe("Personal");
  });

  it("uses the human display name as the rename default instead of duplicating the email", () => {
    const onRenameAiProfile = vi.fn();
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("Ops Team");
    const container = renderAiSettings({ onRenameAiProfile });

    const activeCardRenameButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".alisio-settings-ai__profile.is-active button",
      ),
    ).find((button) => button.textContent?.includes("Rename"));

    activeCardRenameButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(promptSpy).toHaveBeenCalledWith("Give this account a name", "Team");
    expect(onRenameAiProfile).toHaveBeenCalledWith("team-profile", "Ops Team");
  });

  it("does not mark any account as active when the bootstrap has no active binding", () => {
    const baseBootstrap = createBootstrap();
    const bootstrap = createBootstrap({
      ai: {
        ...baseBootstrap.ai,
        status: "disconnected",
        activeProfileId: undefined,
        activeWorkerCredentialId: undefined,
        activeAuthProfileId: undefined,
        binding: undefined,
      },
    });
    const container = renderAiSettings({}, bootstrap);

    expect(container.querySelector(".alisio-settings-ai__profile.is-active")).toBeNull();
    expect(container.textContent).toContain("Activate");
  });
});
