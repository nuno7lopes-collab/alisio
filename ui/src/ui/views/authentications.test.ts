/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderAuthentications } from "./authentications.ts";

describe("authentications view", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("renders only external apps even when the overview includes assistant, providers, and runtimes", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        overview: {
          generatedAt: new Date().toISOString(),
          summary: {
            connected: 3,
            ready: 1,
            attention: 1,
            total: 5,
          },
          account: {} as never,
          ai: {} as never,
          connectors: {
            catalog: [
              {
                id: "github",
                title: "GitHub",
                providerLabel: "GitHub",
                category: "development",
                connectLabel: "Connect with GitHub",
                summary: "Repository and pull request workflows.",
                availability: "ready",
                scopes: ["repo"],
              },
            ],
            authorizations: [
              {
                connectorId: "github",
                state: "connected",
                health: "healthy",
                scopes: ["repo"],
                connectedAccount: {
                  label: "Nuno",
                  email: "nuno@example.com",
                },
              },
            ],
          },
          assistant: [
            {
              id: "alisio-ai",
              title: "Alisio AI",
              subtitle: "nuno@example.com",
              detail: "Primary AI account is ready for chat and runtime use.",
              status: "connected",
              authSource: "alisio-ai",
              chips: ["OpenAI", "Plus"],
              usageWindows: [{ label: "5h", usedPercent: 42 }],
              current: true,
              active: true,
            },
          ],
          providers: [
            {
              id: "openai",
              title: "OpenAI",
              subtitle: "Text · Image · Speech",
              detail: "Stored authentication is ready for runtime use.",
              status: "connected",
              authSource: "profiles",
              chips: ["Text", "Image", "Speech"],
              usageWindows: [],
              current: false,
              active: true,
            },
          ],
          runtimes: [
            {
              id: "runtime-1",
              title: "MacBook Pro",
              subtitle: "Local GGUF",
              detail: "1 installed model ready on this runtime.",
              status: "connected",
              authSource: "runtime",
              chips: ["Local runtime", "Current device"],
              usageWindows: [],
              current: true,
              active: true,
            },
          ],
          apps: [
            {
              id: "connector:github",
              title: "GitHub",
              subtitle: "Repository and pull request workflows.",
              status: "connected",
              authSource: "connector",
              connectorId: "github",
              connectLabel: "Connect with GitHub",
              chips: ["GitHub", "Development"],
              usageWindows: [],
              current: false,
              active: true,
            },
          ],
        },
        connectorCatalog: [],
        connectorAuthorizations: [],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("External apps");
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).not.toContain("Primary assistant account");
    expect(container.textContent).not.toContain("Model providers");
    expect(container.textContent).not.toContain("Runtimes and nodes");
  });

  it("renders connected external apps from the overview and keeps revoke actions wired", () => {
    const container = document.createElement("div");
    const onRevokeConnector = vi.fn();

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        overview: {
          generatedAt: new Date().toISOString(),
          summary: {
            connected: 1,
            ready: 0,
            attention: 0,
            total: 1,
          },
          account: {} as never,
          ai: {} as never,
          connectors: {
            catalog: [
              {
                id: "gmail-send",
                title: "Gmail Send",
                providerLabel: "Google",
                category: "google",
                connectLabel: "Connect with Google",
                summary: "Send outbound email drafts.",
                availability: "ready",
                scopes: ["https://www.googleapis.com/auth/gmail.send"],
              },
            ],
            authorizations: [
              {
                connectorId: "gmail-send",
                state: "connected",
                health: "healthy",
                scopes: ["https://www.googleapis.com/auth/gmail.send"],
                connectedAccount: {
                  label: "Nuno",
                  email: "nuno@example.com",
                },
              },
            ],
          },
          assistant: [],
          providers: [],
          runtimes: [],
          apps: [
            {
              id: "connector:gmail-send",
              title: "Gmail Send",
              subtitle: "Send outbound email drafts.",
              status: "connected",
              authSource: "connector",
              connectorId: "gmail-send",
              connectLabel: "Connect with Google",
              chips: ["Google", "Productivity"],
              usageWindows: [],
              current: false,
              active: true,
            },
          ],
        },
        connectorCatalog: [],
        connectorAuthorizations: [],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector,
      }),
      container,
    );

    expect(container.textContent).toContain("External apps");
    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Revoke"),
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRevokeConnector).toHaveBeenCalledWith("gmail-send");
  });

  it("shows connected external apps in the top connected section", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        overview: {
          generatedAt: new Date().toISOString(),
          summary: {
            connected: 1,
            ready: 1,
            attention: 0,
            total: 2,
          },
          account: {} as never,
          ai: {} as never,
          connectors: {
            catalog: [],
            authorizations: [],
          },
          assistant: [],
          providers: [],
          runtimes: [],
          apps: [
            {
              id: "connector:google-docs",
              title: "Google Docs",
              subtitle: "Read and create document workflows in Google Docs.",
              status: "connected",
              authSource: "connector",
              connectorId: "google-docs",
              connectLabel: "Connect with Google",
              chips: ["Google"],
              usageWindows: [],
              current: false,
              active: true,
            },
            {
              id: "connector:notion",
              title: "Notion",
              subtitle: "Workspace pages and database flows still rolling out.",
              status: "coming_soon",
              authSource: "connector",
              connectorId: "notion",
              connectLabel: "Connect with Notion",
              chips: ["Notion"],
              usageWindows: [],
              current: false,
              active: false,
            },
          ],
        },
        connectorCatalog: [
          {
            id: "google-docs",
            title: "Google Docs",
            providerLabel: "Google",
            category: "google",
            connectLabel: "Connect with Google",
            summary: "Read and create document workflows in Google Docs.",
            availability: "ready",
            scopes: ["https://www.googleapis.com/auth/documents"],
          },
          {
            id: "notion",
            title: "Notion",
            providerLabel: "Notion",
            category: "development",
            connectLabel: "Connect with Notion",
            summary: "Workspace pages and database flows still rolling out.",
            availability: "ready",
            scopes: ["contents"],
          },
        ],
        connectorAuthorizations: [
          {
            connectorId: "google-docs",
            state: "connected",
            health: "healthy",
            scopes: ["https://www.googleapis.com/auth/documents"],
          },
        ],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
      }),
      container,
    );

    const connectedSection = container.querySelector('[data-section="connected"]');
    const availableSection = container.querySelector('[data-section="available"]');
    expect(connectedSection?.textContent).toContain("Already connected");
    expect(connectedSection?.textContent).toContain("Google Docs");
    expect(connectedSection?.textContent).not.toContain("Notion");
    expect(connectedSection?.querySelector(".alisio-auth-grid")).not.toBeNull();
    expect(connectedSection?.querySelector(".alisio-auth-card--compact")).not.toBeNull();
    expect(availableSection?.textContent).toContain("Available apps");
    expect(availableSection?.textContent).toContain("Notion");
  });

  it("keeps new external app connections available on the free plan", () => {
    const container = document.createElement("div");
    const onBeginConnector = vi.fn();

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: {
          profile: {
            plan: "free",
          },
        } as never,
        overview: {
          generatedAt: new Date().toISOString(),
          summary: {
            connected: 1,
            ready: 1,
            attention: 0,
            total: 2,
          },
          account: {} as never,
          ai: {} as never,
          connectors: {
            catalog: [],
            authorizations: [],
          },
          assistant: [],
          providers: [],
          runtimes: [],
          apps: [
            {
              id: "connector:gmail-send",
              title: "Gmail Send",
              subtitle: "Send outbound email drafts.",
              status: "connected",
              authSource: "connector",
              connectorId: "gmail-send",
              connectLabel: "Connect with Google",
              chips: ["Google"],
              usageWindows: [],
              current: false,
              active: true,
            },
            {
              id: "connector:github",
              title: "GitHub",
              subtitle: "Repository and pull request workflows.",
              status: "ready",
              authSource: "connector",
              connectorId: "github",
              connectLabel: "Connect with GitHub",
              chips: ["GitHub"],
              usageWindows: [],
              current: false,
              active: false,
            },
          ],
        },
        connectorCatalog: [
          {
            id: "gmail-send",
            title: "Gmail Send",
            providerLabel: "Google",
            category: "google",
            connectLabel: "Connect with Google",
            summary: "Send outbound email drafts.",
            availability: "ready",
            scopes: ["https://www.googleapis.com/auth/gmail.send"],
          },
          {
            id: "github",
            title: "GitHub",
            providerLabel: "GitHub",
            category: "development",
            connectLabel: "Connect with GitHub",
            summary: "Repository and pull request workflows.",
            availability: "ready",
            scopes: ["repo"],
          },
        ],
        connectorAuthorizations: [
          {
            connectorId: "gmail-send",
            state: "connected",
            health: "healthy",
            scopes: ["https://www.googleapis.com/auth/gmail.send"],
          },
        ],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector,
        onRevokeConnector: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).not.toContain("Free includes 1 connected app.");
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.includes("Connect with GitHub"),
    );
    expect(button?.disabled).toBe(false);
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onBeginConnector).toHaveBeenCalledWith("github");
  });

  it("renders ready apps as compact cards with a minimal connect action", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        overview: {
          generatedAt: new Date().toISOString(),
          summary: {
            connected: 0,
            ready: 1,
            attention: 0,
            total: 1,
          },
          account: {} as never,
          ai: {} as never,
          connectors: {
            catalog: [],
            authorizations: [],
          },
          assistant: [],
          providers: [],
          runtimes: [],
          apps: [
            {
              id: "connector:gmail-send",
              title: "Gmail Send",
              subtitle: "Send outbound email drafts.",
              status: "ready",
              authSource: "connector",
              connectorId: "gmail-send",
              connectLabel: "Connect with Google",
              chips: ["Google"],
              usageWindows: [],
              current: false,
              active: false,
            },
          ],
        },
        connectorCatalog: [
          {
            id: "gmail-send",
            title: "Gmail Send",
            providerLabel: "Google",
            category: "google",
            connectLabel: "Connect with Google",
            summary: "Send outbound email drafts.",
            availability: "ready",
            scopes: ["https://www.googleapis.com/auth/gmail.send"],
          },
        ],
        connectorAuthorizations: [],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
      }),
      container,
    );

    const availableSection = container.querySelector('[data-section="available"]');
    const connectButton = availableSection?.querySelector<HTMLButtonElement>(
      ".alisio-auth-card__connect-btn",
    );

    expect(availableSection?.querySelector(".alisio-auth-grid")).not.toBeNull();
    expect(availableSection?.querySelector(".alisio-auth-card--compact")).not.toBeNull();
    expect(availableSection?.querySelector(".chip")).toBeNull();
    expect(availableSection?.querySelector(".pill--ready")).toBeNull();
    expect(connectButton?.textContent).toContain("Connect with Google");
    expect(connectButton?.classList.contains("alisio-auth-card__connect-btn--compact")).toBe(true);
    expect(connectButton?.getAttribute("aria-label")).toBe("Connect with Google");
    expect(connectButton?.textContent).toContain("+");
  });

  it("keeps coming soon badges visible when an app is not ready yet", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        overview: {
          generatedAt: new Date().toISOString(),
          summary: {
            connected: 0,
            ready: 0,
            attention: 0,
            total: 1,
          },
          account: {} as never,
          ai: {} as never,
          connectors: {
            catalog: [],
            authorizations: [],
          },
          assistant: [],
          providers: [],
          runtimes: [],
          apps: [
            {
              id: "connector:instagram",
              title: "Instagram",
              subtitle: "Professional Instagram account access.",
              status: "coming_soon",
              authSource: "connector",
              connectorId: "instagram",
              connectLabel: "Connect with Instagram",
              chips: ["Meta"],
              usageWindows: [],
              current: false,
              active: false,
            },
          ],
        },
        connectorCatalog: [
          {
            id: "instagram",
            title: "Instagram",
            providerLabel: "Meta",
            category: "social",
            connectLabel: "Connect with Instagram",
            summary: "Professional Instagram account access.",
            availability: "in_review",
            scopes: ["instagram_basic"],
          },
        ],
        connectorAuthorizations: [],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
      }),
      container,
    );

    const availableSection = container.querySelector('[data-section="available"]');
    expect(availableSection?.textContent).toContain("Coming soon");
    expect(availableSection?.querySelector(".alisio-auth-card__connect-btn")).toBeNull();
  });

  it("keeps revoke available for already linked apps that are still coming soon", () => {
    const container = document.createElement("div");
    const onRevokeConnector = vi.fn();

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        overview: {
          generatedAt: new Date().toISOString(),
          summary: {
            connected: 0,
            ready: 0,
            attention: 0,
            total: 1,
          },
          account: {} as never,
          ai: {} as never,
          connectors: {
            catalog: [],
            authorizations: [],
          },
          assistant: [],
          providers: [],
          runtimes: [],
          apps: [
            {
              id: "connector:notion",
              title: "Notion",
              subtitle: "Workspace pages and database flows still rolling out.",
              status: "coming_soon",
              authSource: "connector",
              connectorId: "notion",
              connectLabel: "Connect with Notion",
              chips: ["Notion"],
              usageWindows: [],
              current: false,
              active: false,
            },
          ],
        },
        connectorCatalog: [
          {
            id: "notion",
            title: "Notion",
            providerLabel: "Notion",
            category: "development",
            connectLabel: "Connect with Notion",
            summary: "Workspace pages and database flows still rolling out.",
            availability: "ready",
            scopes: ["contents"],
          },
        ],
        connectorAuthorizations: [
          {
            connectorId: "notion",
            state: "connected",
            health: "healthy",
            scopes: ["contents"],
            connectedAccount: {
              label: "Nuno",
              email: "nuno@example.com",
            },
          },
        ],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector,
      }),
      container,
    );

    const availableSection = container.querySelector('[data-section="available"]');
    expect(availableSection?.textContent).toContain("Coming soon");
    const revokeButton = Array.from(availableSection?.querySelectorAll("button") ?? []).find(
      (candidate) => candidate.textContent?.includes("Revoke"),
    );
    revokeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRevokeConnector).toHaveBeenCalledWith("notion");
  });

  it("falls back to coming soon for catalog-ready connectors without runtime support", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        overview: null,
        connectorCatalog: [
          {
            id: "notion",
            title: "Notion",
            providerLabel: "Notion",
            category: "development",
            connectLabel: "Connect with Notion",
            summary: "Repositories and pull requests.",
            availability: "ready",
            scopes: ["repo"],
          },
        ],
        connectorAuthorizations: [
          {
            connectorId: "notion",
            state: "not_connected",
            health: "healthy",
            scopes: ["repo"],
          },
        ],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
      }),
      container,
    );

    const availableSection = container.querySelector('[data-section="available"]');
    expect(availableSection?.textContent).toContain("Coming soon");
    expect(availableSection?.textContent).toContain("Notion");
    expect(availableSection?.querySelector(".alisio-auth-card__connect-btn")).toBeNull();
  });

  it("renders loading skeletons while the provider overview is still loading", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: true,
        error: null,
        account: null,
        overview: null,
        connectorCatalog: [],
        connectorAuthorizations: [],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
      }),
      container,
    );

    expect(container.querySelectorAll(".alisio-auth-card")).toHaveLength(3);
  });

  it("prefers live connector status over stale overview app status", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        overview: {
          generatedAt: new Date().toISOString(),
          summary: {
            connected: 0,
            ready: 0,
            attention: 0,
            total: 1,
          },
          account: {} as never,
          ai: {} as never,
          connectors: {
            catalog: [
              {
                id: "github",
                title: "GitHub",
                providerLabel: "GitHub",
                category: "development",
                connectLabel: "Connect with GitHub",
                summary: "Repository workflows.",
                availability: "ready",
                scopes: ["repo"],
              },
            ],
            authorizations: [],
          },
          assistant: [],
          providers: [],
          runtimes: [],
          apps: [
            {
              id: "connector:github",
              title: "GitHub",
              subtitle: "Repository workflows.",
              status: "coming_soon",
              authSource: "connector",
              connectorId: "github",
              connectLabel: "Connect with GitHub",
              chips: ["GitHub"],
              usageWindows: [],
              current: false,
              active: false,
            },
          ],
        },
        connectorCatalog: [
          {
            id: "github",
            title: "GitHub",
            providerLabel: "GitHub",
            category: "development",
            connectLabel: "Connect with GitHub",
            summary: "Repository workflows.",
            availability: "ready",
            scopes: ["repo"],
          },
        ],
        connectorAuthorizations: [],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
      }),
      container,
    );

    const availableSection = container.querySelector('[data-section="available"]');
    expect(availableSection?.textContent).toContain("GitHub");
    expect(availableSection?.textContent).not.toContain("Coming soon");
    expect(
      Array.from(availableSection?.querySelectorAll("button") ?? []).some((candidate) =>
        candidate.textContent?.includes("Connect with GitHub"),
      ),
    ).toBe(true);
  });

  it("renders from live connector data even while the overview is still loading", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: true,
        error: null,
        account: null,
        overview: null,
        connectorCatalog: [
          {
            id: "github",
            title: "GitHub",
            providerLabel: "GitHub",
            category: "development",
            connectLabel: "Connect with GitHub",
            summary: "Repository workflows.",
            availability: "ready",
            scopes: ["repo"],
          },
        ],
        connectorAuthorizations: [],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("GitHub");
    expect(container.querySelectorAll(".alisio-auth-card")).toHaveLength(1);
  });

  it("shows missing-config connectors as unavailable without a connect action", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications({
        loading: false,
        error: null,
        account: null,
        overview: null,
        connectorCatalog: [
          {
            id: "github",
            title: "GitHub",
            providerLabel: "GitHub",
            category: "development",
            connectLabel: "Connect with GitHub",
            summary: "Repository workflows.",
            availability: "ready",
            scopes: ["repo"],
          },
        ],
        connectorAuthorizations: [
          {
            connectorId: "github",
            state: "not_connected",
            health: "config_missing",
            scopes: ["repo"],
          },
        ],
        search: "",
        onSearchChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
      }),
      container,
    );

    const availableSection = container.querySelector('[data-section="available"]');
    expect(availableSection?.textContent).toContain("GitHub");
    expect(availableSection?.textContent).toContain("Unavailable");
    expect(
      Array.from(availableSection?.querySelectorAll("button") ?? []).some((candidate) =>
        candidate.textContent?.includes("Connect with GitHub"),
      ),
    ).toBe(false);
    expect(
      Array.from(availableSection?.querySelectorAll("button") ?? []).some((candidate) =>
        candidate.textContent?.includes("Configure"),
      ),
    ).toBe(false);
  });
});
