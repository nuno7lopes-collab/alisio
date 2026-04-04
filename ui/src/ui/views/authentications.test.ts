/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderAuthentications } from "./authentications.ts";

describe("authentications view", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("never renders technical setup details in the public authentications view", () => {
    window.history.replaceState({}, "", "/authentications");
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        connectorCatalog: [
          {
            id: "google-calendar",
            title: "Google Calendar",
            providerLabel: "Google",
            category: "google",
            connectLabel: "Connect with Google",
            summary: "Calendar access.",
            availability: "ready",
            scopes: ["openid", "email"],
          },
          {
            id: "linkedin",
            title: "LinkedIn",
            providerLabel: "LinkedIn",
            category: "social",
            connectLabel: "Connect with LinkedIn",
            summary: "LinkedIn access.",
            availability: "ready",
            scopes: ["r_liteprofile"],
          },
        ],
        connectorAuthorizations: [],
        setupGuide: {
          connectorId: "google-calendar",
          availability: "ready",
          mode: "setup",
          provider: "google",
          providerLabel: "Google",
          statusReason: "missing_client_config",
          callbackPath: "/oauth/google/callback",
          requiredEnvVars: [
            "ALISIO_GOOGLE_CLIENT_ID",
            "ALISIO_GOOGLE_CLIENT_SECRET",
            "ALISIO_GOOGLE_REDIRECT_URI",
          ],
          setupUrl: "https://developers.google.com/identity/protocols/oauth2",
          setupHint: "Google Calendar can complete native Google OAuth in Alisio.",
        },
        search: "",
        categoryFilter: "all",
        onSearchChange: vi.fn(),
        onCategoryChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
        onOpenChannels: vi.fn(),
        onDismissSetupGuide: vi.fn(),
        onOpenSupportUrl: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).not.toContain("Finish OAuth setup in Alisio");
    expect(container.textContent).not.toContain("ALISIO_GOOGLE_CLIENT_ID");
    expect(container.textContent).not.toContain("Suggested callback URL");
    expect(container.textContent).not.toContain(`${window.location.origin}/oauth/google/callback`);
    expect(container.textContent).not.toContain("Provider docs");
    expect(container.querySelector(".alisio-auth-setup")).toBeNull();
    expect(container.querySelector(".alisio-auth-card__icon-fallback")).toBeNull();
    expect(
      container.querySelector(
        'img[src*="commons.wikimedia.org/wiki/Special:FilePath/LinkedIn_icon.svg"]',
      ),
    ).not.toBeNull();
  });

  it("shows setup-required connectors as preparing without exposing an action", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        connectorCatalog: [
          {
            id: "gmail-send",
            title: "Gmail Send",
            providerLabel: "Google",
            category: "google",
            connectLabel: "Connect with Google",
            summary: "Send email via Gmail.",
            availability: "ready",
            scopes: ["https://www.googleapis.com/auth/gmail.send"],
          },
        ],
        connectorAuthorizations: [
          {
            connectorId: "gmail-send",
            state: "not_connected",
            health: "config_missing",
            scopes: ["https://www.googleapis.com/auth/gmail.send"],
          },
        ],
        setupGuide: null,
        search: "",
        categoryFilter: "all",
        onSearchChange: vi.fn(),
        onCategoryChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
        onOpenChannels: vi.fn(),
        onDismissSetupGuide: vi.fn(),
        onOpenSupportUrl: vi.fn(),
      }),
      container,
    );

    const badge = container.querySelector(".pill");
    expect(badge?.textContent).toContain("Preparing");
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Configure"),
      ),
    ).toBe(false);
  });

  it("shows genuinely ready connectors as connectable before any OAuth exists", () => {
    const container = document.createElement("div");
    const onBeginConnector = vi.fn();

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        connectorCatalog: [
          {
            id: "gmail-send",
            title: "Gmail Send",
            providerLabel: "Google",
            category: "google",
            connectLabel: "Connect with Google",
            summary: "Send email via Gmail.",
            availability: "ready",
            scopes: ["https://www.googleapis.com/auth/gmail.send"],
          },
        ],
        connectorAuthorizations: [
          {
            connectorId: "gmail-send",
            state: "not_connected",
            health: "healthy",
            scopes: ["https://www.googleapis.com/auth/gmail.send"],
          },
        ],
        setupGuide: null,
        search: "",
        categoryFilter: "all",
        onSearchChange: vi.fn(),
        onCategoryChange: vi.fn(),
        onBeginConnector,
        onRevokeConnector: vi.fn(),
        onOpenChannels: vi.fn(),
        onDismissSetupGuide: vi.fn(),
        onOpenSupportUrl: vi.fn(),
      }),
      container,
    );

    const badge = container.querySelector(".pill");
    expect(badge?.textContent).toContain("Ready");
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Connect with Google");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onBeginConnector).toHaveBeenCalledWith("gmail-send");
  });

  it("does not duplicate already connected apps in category sections", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        connectorCatalog: [
          {
            id: "gmail-send",
            title: "Gmail Send",
            providerLabel: "Google",
            category: "google",
            connectLabel: "Connect with Google",
            summary: "Send email via Gmail.",
            availability: "ready",
            scopes: ["https://www.googleapis.com/auth/gmail.send"],
          },
        ],
        connectorAuthorizations: [
          {
            connectorId: "gmail-send",
            state: "connected",
            health: "healthy",
            scopes: ["https://www.googleapis.com/auth/gmail.send"],
            connectedAccount: {
              label: "Nuno Lopes",
              email: "nuno@example.com",
            },
          },
        ],
        setupGuide: null,
        search: "",
        categoryFilter: "all",
        onSearchChange: vi.fn(),
        onCategoryChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
        onOpenChannels: vi.fn(),
        onDismissSetupGuide: vi.fn(),
        onOpenSupportUrl: vi.fn(),
      }),
      container,
    );

    expect(container.querySelectorAll(".alisio-auth-card")).toHaveLength(1);
    expect(container.textContent).toContain("Already connected");
  });
});
