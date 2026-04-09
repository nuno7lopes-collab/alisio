/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderAuthentications } from "./authentications.ts";

describe("authentications view", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("renders the unified provider overview sections", () => {
    const container = document.createElement("div");
    const onOpenModels = vi.fn();

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
            catalog: [],
            authorizations: [],
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
          apps: [],
        },
        connectorCatalog: [],
        connectorAuthorizations: [],
        search: "",
        categoryFilter: "all",
        onSearchChange: vi.fn(),
        onCategoryChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
        onOpenModels,
      }),
      container,
    );

    expect(container.textContent).toContain("Providers");
    expect(container.textContent).toContain("Primary assistant account");
    expect(container.textContent).toContain("Model providers");
    expect(container.textContent).toContain("Runtimes and servers");

    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Open models"),
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenModels).toHaveBeenCalledOnce();
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
        categoryFilter: "all",
        onSearchChange: vi.fn(),
        onCategoryChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector,
        onOpenModels: vi.fn(),
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

  it("disables new external app connections when the free plan slot is already occupied", () => {
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
        categoryFilter: "all",
        onSearchChange: vi.fn(),
        onCategoryChange: vi.fn(),
        onBeginConnector,
        onRevokeConnector: vi.fn(),
        onOpenModels: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("Free includes 1 connected app.");
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.includes("Connect with GitHub"),
    );
    expect(button?.disabled).toBe(true);
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onBeginConnector).not.toHaveBeenCalled();
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
        categoryFilter: "all",
        onSearchChange: vi.fn(),
        onCategoryChange: vi.fn(),
        onBeginConnector: vi.fn(),
        onRevokeConnector: vi.fn(),
        onOpenModels: vi.fn(),
      }),
      container,
    );

    expect(container.querySelectorAll(".loading-state__stat-card")).toHaveLength(3);
    expect(container.querySelectorAll(".alisio-auth-card")).toHaveLength(3);
  });
});
