/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type {
  AlisioConnectorAuthorization,
  AlisioConnectorsBeginResult,
  AlisioConnectorDefinition,
  AlisioProviderOverviewItem,
  AlisioProvidersState,
} from "../types.ts";
import { renderAuthentications } from "./authentications.ts";

function connector(
  overrides: Partial<AlisioConnectorDefinition> & Pick<AlisioConnectorDefinition, "id" | "title">,
): AlisioConnectorDefinition {
  return {
    providerLabel: "GitHub",
    category: "development",
    connectLabel: "Connect with GitHub",
    summary: "Repository workflows.",
    availability: "ready",
    scopes: ["repo"],
    ...overrides,
  };
}

function authorization(
  overrides: Partial<AlisioConnectorAuthorization> &
    Pick<AlisioConnectorAuthorization, "connectorId">,
): AlisioConnectorAuthorization {
  return {
    state: "not_connected",
    health: "healthy",
    scopes: ["repo"],
    ...overrides,
  };
}

function appItem(
  overrides: Partial<AlisioProviderOverviewItem> &
    Pick<AlisioProviderOverviewItem, "id" | "title" | "subtitle" | "status" | "authSource">,
): AlisioProviderOverviewItem {
  return {
    chips: [],
    usageWindows: [],
    current: false,
    active: false,
    ...overrides,
  };
}

function overview(
  overrides: Partial<AlisioProvidersState> & Pick<AlisioProvidersState, "apps" | "connectors">,
): AlisioProvidersState {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      connected: 0,
      ready: 0,
      attention: 0,
      total: overrides.apps.length,
    },
    account: {} as never,
    ai: {} as never,
    assistant: [],
    providers: [],
    runtimes: [],
    ...overrides,
  };
}

function createProps(
  overrides: Partial<Parameters<typeof renderAuthentications>[0]> = {},
): Parameters<typeof renderAuthentications>[0] {
  return {
    loading: false,
    error: null,
    account: null,
    overview: null,
    connectorCatalog: [],
    connectorAuthorizations: [],
    connectorSetupGuide: null,
    connectorSetupSubmitting: false,
    connectorSetupError: null,
    search: "",
    dialogConnectorId: null,
    dialogMode: null,
    onSearchChange: vi.fn(),
    onOpenConnectorDetails: vi.fn(),
    onOpenConnectorInstall: vi.fn(),
    onCloseConnectorDialog: vi.fn(),
    onBeginConnector: vi.fn(),
    onCompleteManualConnector: vi.fn(),
    onRevokeConnector: vi.fn(),
    onTryConnectorInChat: vi.fn(),
    ...overrides,
  };
}

describe("authentications view", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("renders only external apps even when the overview includes assistant, providers, and runtimes", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications(
        createProps({
          overview: overview({
            connectors: {
              catalog: [connector({ id: "github", title: "GitHub" })],
              authorizations: [authorization({ connectorId: "github", state: "connected" })],
            },
            assistant: [
              appItem({
                id: "alisio-ai",
                title: "Alisio AI",
                subtitle: "nuno@example.com",
                status: "connected",
                authSource: "alisio-ai",
              }),
            ],
            providers: [
              appItem({
                id: "openai",
                title: "OpenAI",
                subtitle: "Text",
                status: "connected",
                authSource: "profiles",
              }),
            ],
            runtimes: [
              appItem({
                id: "runtime-1",
                title: "MacBook Pro",
                subtitle: "Local",
                status: "connected",
                authSource: "runtime",
              }),
            ],
            apps: [
              appItem({
                id: "connector:github",
                title: "GitHub",
                subtitle: "Repository workflows.",
                status: "connected",
                authSource: "connector",
                connectorId: "github",
                connectLabel: "Connect with GitHub",
              }),
            ],
          }),
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Apps");
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).not.toContain("Alisio AI");
    expect(container.textContent).not.toContain("OpenAI");
    expect(container.textContent).not.toContain("MacBook Pro");
  });

  it("groups already linked apps in the connected panel even when rollout status is coming soon", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications(
        createProps({
          overview: overview({
            connectors: {
              catalog: [],
              authorizations: [],
            },
            apps: [
              appItem({
                id: "connector:notion",
                title: "Notion",
                subtitle: "Workspace pages.",
                status: "coming_soon",
                authSource: "connector",
                connectorId: "notion",
                connectLabel: "Connect with Notion",
              }),
              appItem({
                id: "connector:github",
                title: "GitHub",
                subtitle: "Repository workflows.",
                status: "ready",
                authSource: "connector",
                connectorId: "github",
                connectLabel: "Connect with GitHub",
              }),
            ],
          }),
          connectorCatalog: [
            connector({
              id: "notion",
              title: "Notion",
              providerLabel: "Notion",
              category: "productivity",
              connectLabel: "Connect with Notion",
              summary: "Workspace pages.",
            }),
            connector({ id: "github", title: "GitHub" }),
          ],
          connectorAuthorizations: [
            authorization({
              connectorId: "notion",
              state: "connected",
              connectedAccount: { label: "Nuno", email: "nuno@example.com" },
            }),
          ],
        }),
      ),
      container,
    );

    const connectedSection = container.querySelector('[data-section="connected"]');
    const availableSection = container.querySelector('[data-section="available"]');

    expect(connectedSection?.textContent).toContain("Already connected");
    expect(connectedSection?.textContent).toContain("Notion");
    expect(availableSection?.textContent).toContain("GitHub");
    expect(availableSection?.textContent).not.toContain("Notion");
  });

  it("opens detail on row click and install on plus click for ready apps", () => {
    const container = document.createElement("div");
    const onOpenConnectorDetails = vi.fn();
    const onOpenConnectorInstall = vi.fn();

    render(
      renderAuthentications(
        createProps({
          connectorCatalog: [connector({ id: "github", title: "GitHub" })],
          onOpenConnectorDetails,
          onOpenConnectorInstall,
        }),
      ),
      container,
    );

    container
      .querySelector<HTMLButtonElement>(".alisio-app-row__surface")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector<HTMLButtonElement>(".alisio-app-row__indicator.is-action")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onOpenConnectorDetails).toHaveBeenCalledWith("github");
    expect(onOpenConnectorInstall).toHaveBeenCalledWith("github");
  });

  it("renders the detail dialog for linked apps and wires try in chat plus remove", () => {
    const container = document.createElement("div");
    const onTryConnectorInChat = vi.fn();
    const onRevokeConnector = vi.fn();

    render(
      renderAuthentications(
        createProps({
          dialogConnectorId: "gmail-send",
          dialogMode: "details",
          connectorCatalog: [
            connector({
              id: "gmail-send",
              title: "Gmail Send",
              providerLabel: "Google",
              category: "google",
              connectLabel: "Connect with Google",
              summary: "Send outbound email drafts.",
            }),
          ],
          connectorAuthorizations: [
            authorization({
              connectorId: "gmail-send",
              state: "connected",
              connectedAccount: { label: "Nuno", email: "nuno@example.com" },
            }),
          ],
          onTryConnectorInChat,
          onRevokeConnector,
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Connected account");
    expect(container.textContent).toContain("nuno@example.com");

    const tryButton = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Try in chat"),
    );
    const removeButton = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Remove"),
    );

    tryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onTryConnectorInChat).toHaveBeenCalledWith("gmail-send");
    expect(onRevokeConnector).toHaveBeenCalledWith("gmail-send");
  });

  it("renders the install dialog from the plus action and starts the connector flow", () => {
    const container = document.createElement("div");
    const onBeginConnector = vi.fn();

    render(
      renderAuthentications(
        createProps({
          dialogConnectorId: "github",
          dialogMode: "install",
          connectorCatalog: [connector({ id: "github", title: "GitHub" })],
          onBeginConnector,
        }),
      ),
      container,
    );

    const installButton = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Install GitHub"),
    );
    installButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onBeginConnector).toHaveBeenCalledWith("github");
  });

  it("renders Stripe manual setup inside the install dialog and submits the API key", () => {
    const container = document.createElement("div");
    const onCompleteManualConnector = vi.fn();
    const connectorSetupGuide: AlisioConnectorsBeginResult = {
      connectorId: "stripe",
      availability: "ready",
      mode: "setup",
      statusReason: "ready_for_setup",
      providerLabel: "Stripe",
      setupHint: "Paste a Stripe secret or restricted API key.",
    };

    render(
      renderAuthentications(
        createProps({
          dialogConnectorId: "stripe",
          dialogMode: "install",
          connectorCatalog: [
            connector({
              id: "stripe",
              title: "Stripe",
              providerLabel: "Stripe",
              category: "productivity",
              connectLabel: "Connect with Stripe",
              summary: "Payments and customer data.",
            }),
          ],
          connectorSetupGuide,
          onCompleteManualConnector,
        }),
      ),
      container,
    );

    const input = container.querySelector<HTMLInputElement>('input[name="apiKey"]');
    expect(input?.placeholder).toContain("sk_live");
    expect(container.textContent).toContain("Stripe API key");
    input!.value = "rk_live_test_readonly";
    container
      .querySelector<HTMLFormElement>(".alisio-auth-dialog__manual-form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(onCompleteManualConnector).toHaveBeenCalledWith("stripe", "rk_live_test_readonly");
  });

  it("filters apps by search across both panels", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications(
        createProps({
          search: "calendar",
          connectorCatalog: [
            connector({
              id: "google-calendar",
              title: "Google Calendar",
              providerLabel: "Google",
              category: "google",
              connectLabel: "Connect with Google",
              summary: "Calendar workflows.",
            }),
            connector({ id: "github", title: "GitHub" }),
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Google Calendar");
    expect(container.textContent).not.toContain("GitHub");
  });

  it("shows unavailable apps without an install action when OAuth config is missing", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications(
        createProps({
          connectorCatalog: [connector({ id: "github", title: "GitHub" })],
          connectorAuthorizations: [
            authorization({
              connectorId: "github",
              health: "config_missing",
            }),
          ],
        }),
      ),
      container,
    );

    const availableSection = container.querySelector('[data-section="available"]');
    expect(availableSection?.textContent).toContain("Unavailable");
    expect(availableSection?.querySelector(".alisio-app-row__indicator.is-action")).toBeNull();
  });

  it("renders split-panel loading state on the first load", () => {
    const container = document.createElement("div");

    render(
      renderAuthentications(
        createProps({
          loading: true,
        }),
      ),
      container,
    );

    expect(container.querySelector(".loading-state__toolbar")).not.toBeNull();
    expect(container.querySelectorAll(".alisio-auth-panel")).toHaveLength(2);
    expect(container.querySelectorAll(".loading-state__list-item").length).toBeGreaterThan(0);
  });
});
