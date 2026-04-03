/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderAuthentications } from "./authentications.ts";

describe("authentications view", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("renders the in-product setup guide for missing provider config", () => {
    window.history.replaceState({}, "", "/authentications");
    const container = document.createElement("div");
    const dismiss = vi.fn();
    const support = vi.fn();

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
        onDismissSetupGuide: dismiss,
        onOpenSupportUrl: support,
      }),
      container,
    );

    expect(container.textContent).toContain("Finish OAuth setup in Alisio");
    expect(container.textContent).toContain("ALISIO_GOOGLE_CLIENT_ID");
    expect(container.textContent).toContain("Suggested callback URL");
    expect(container.textContent).toContain(`${window.location.origin}/oauth/google/callback`);
    expect(container.querySelector(".alisio-auth-setup")).not.toBeNull();
  });
});
