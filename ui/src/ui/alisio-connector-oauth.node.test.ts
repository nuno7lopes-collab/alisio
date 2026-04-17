import { describe, expect, it, vi } from "vitest";
import {
  buildPendingAlisioConnectorChatResume,
  refreshAfterAlisioConnectorOAuth,
} from "./alisio-connector-oauth.ts";

const loadAlisioConnectorsMock = vi.hoisted(() =>
  vi.fn(async (_target?: unknown, _opts?: unknown) => undefined),
);
const loadAlisioDoctorSummaryMock = vi.hoisted(() =>
  vi.fn(async (_target?: unknown, _opts?: unknown) => undefined),
);
const loadAlisioProviderOverviewMock = vi.hoisted(() =>
  vi.fn(async (_target?: unknown, _opts?: unknown) => undefined),
);

vi.mock("./controllers/alisio.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./controllers/alisio.ts")>();
  return {
    ...actual,
    loadAlisioConnectors: loadAlisioConnectorsMock,
    loadAlisioDoctorSummary: loadAlisioDoctorSummaryMock,
    loadAlisioProviderOverview: loadAlisioProviderOverviewMock,
  };
});

describe("refreshAfterAlisioConnectorOAuth", () => {
  it("reloads connector authorization state after OAuth completes", async () => {
    loadAlisioProviderOverviewMock.mockReset();
    loadAlisioConnectorsMock.mockReset();
    loadAlisioDoctorSummaryMock.mockReset();
    const host = {
      client: null,
      connected: true,
      alisioProvidersLoading: false,
      alisioProvidersError: null,
      alisioProviders: null,
      alisioConnectorsLoading: false,
      alisioConnectorsError: null,
      alisioConnectorCatalog: [],
      alisioConnectorAuthorizations: [],
      alisioConnectorSetupGuide: null,
    };

    await refreshAfterAlisioConnectorOAuth(
      host as unknown as Parameters<typeof refreshAfterAlisioConnectorOAuth>[0],
    );

    expect(loadAlisioProviderOverviewMock).toHaveBeenCalledTimes(1);
    expect(loadAlisioConnectorsMock).toHaveBeenCalledTimes(1);
    expect(loadAlisioDoctorSummaryMock).toHaveBeenCalledTimes(1);
  });

  it("promotes the just-authorized connector immediately while the backend catches up", async () => {
    loadAlisioProviderOverviewMock.mockReset();
    loadAlisioConnectorsMock.mockReset();
    loadAlisioDoctorSummaryMock.mockReset();
    const host = {
      client: null,
      connected: true,
      alisioProvidersLoading: false,
      alisioProvidersError: null,
      alisioProviders: {
        connectors: {
          catalog: [
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
          ],
          authorizations: [],
        },
        apps: [
          {
            id: "connector:google-docs",
            title: "Google Docs",
            subtitle: "Read and create document workflows in Google Docs.",
            status: "ready",
            authSource: "connector",
            connectorId: "google-docs",
            connectLabel: "Connect with Google",
            chips: ["Google"],
            usageWindows: [],
            current: false,
            active: false,
          },
        ],
      },
      alisioConnectorsLoading: false,
      alisioConnectorsError: null,
      alisioConnectorCatalog: [
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
      ],
      alisioConnectorAuthorizations: [],
      alisioConnectorSetupGuide: null,
    };

    loadAlisioProviderOverviewMock.mockImplementation(async (target) => {
      (target as typeof host).alisioProviders = {
        ...(target as typeof host).alisioProviders,
        connectors: {
          ...(target as typeof host).alisioProviders.connectors,
          authorizations: [],
        },
        apps: (target as typeof host).alisioProviders.apps.map((item) => ({
          ...item,
          status: "ready",
          active: false,
        })),
      };
    });
    loadAlisioConnectorsMock.mockImplementation(async (target) => {
      (target as typeof host).alisioConnectorAuthorizations = [];
    });

    await refreshAfterAlisioConnectorOAuth(
      host as unknown as Parameters<typeof refreshAfterAlisioConnectorOAuth>[0],
      {
        type: "connector-oauth-complete",
        connectorId: "google-docs",
        provider: "google",
        signalId: "signal-1",
        createdAtMs: Date.now(),
      },
    );

    expect(host.alisioConnectorAuthorizations).toEqual([
      expect.objectContaining({
        connectorId: "google-docs",
        state: "connected",
        health: "healthy",
      }),
    ]);
    expect(host.alisioProviders.apps).toEqual([
      expect.objectContaining({
        connectorId: "google-docs",
        status: "connected",
        active: true,
      }),
    ]);
  });
});

describe("buildPendingAlisioConnectorChatResume", () => {
  it("prefers an explicit prompt override when the flow starts outside chat", () => {
    const pending = buildPendingAlisioConnectorChatResume({
      connectorId: "youtube",
      sessionKey: "agent:main",
      messageOverride: "Revê o meu canal de YouTube e resume o que precisa de atenção.",
      messages: [],
    });

    expect(pending).toMatchObject({
      connectorId: "youtube",
      sessionKey: "agent:main",
      message: "Revê o meu canal de YouTube e resume o que precisa de atenção.",
    });
  });
});
