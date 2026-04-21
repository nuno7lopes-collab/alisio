import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProviderAuthOverview } from "../commands/models/list.auth-overview.js";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { loadAlisioProviderOverview } from "./alisio-provider-overview.js";

describe("loadAlisioProviderOverview", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a unified overview from real provider, runtime, and connector signals", async () => {
    const result = await loadAlisioProviderOverview({
      usageTimeoutMs: 10,
      includeUsage: true,
      deps: {
        ensureAuthProfileStore: () =>
          ({
            version: 1,
            profiles: {
              "openai-main": {
                type: "oauth",
                provider: "openai",
                access: "access-token",
                refresh: "refresh-token",
                expires: Date.now() + 60_000,
                email: "nuno@example.com",
                displayName: "Nuno",
              },
              "anthropic-key": {
                type: "api_key",
                provider: "anthropic",
                key: "sk-test",
              },
            },
          }) as never,
        readConfigFileSnapshot: async () =>
          ({
            path: "/tmp/models.json",
            valid: true,
            config: {
              models: {
                providers: {
                  openai: {},
                  anthropic: {},
                },
              },
            },
            runtimeConfig: {
              models: {
                providers: {
                  openai: {},
                  anthropic: {},
                },
              },
            },
          }) as never,
        getAlisioAccountState: async () =>
          ({
            profile: {
              username: "nuno",
              displayName: "Nuno",
              email: "nuno@example.com",
              avatarLabel: "N",
              joinedAt: new Date().toISOString(),
              plan: "free",
            },
            preferences: {
              language: "en",
              themeFamily: DEFAULT_THEME_FAMILY,
              themeMode: "system",
              themeAccents: DEFAULT_THEME_ACCENTS,
            },
            session: {
              state: "signed_in",
              profileCompleted: true,
            },
            devices: [
              {
                id: "device-1",
                label: "MacBook Pro",
                platform: "macOS",
                current: true,
                status: "active",
                lastSeenAt: new Date().toISOString(),
              },
            ],
            cloud: {
              backend: "supabase",
              available: true,
              missingEnvVars: [],
            },
          }) as never,
        getAlisioAiState: async () =>
          ({
            provider: "openai",
            status: "connected",
            email: "nuno@example.com",
            planLabel: "Plus",
            profiles: [
              {
                profileId: "openai-main",
                label: "Nuno",
                provider: "openai",
                scope: "user",
                ownerKey: "user:nuno",
                canonicalIdentityKey: "identity:nuno",
                identity: {
                  canonicalIdentityKey: "identity:nuno",
                  source: "email",
                  email: "nuno@example.com",
                },
                status: "connected",
                email: "nuno@example.com",
                planLabel: "Plus",
              },
            ],
            limits: {
              lastRefreshedAt: new Date().toISOString(),
              windows: [
                {
                  label: "5h",
                  usedPercent: 42,
                },
              ],
            },
          }) as never,
        listAlisioConnectorDefinitions: () =>
          [
            {
              id: "google-docs",
              title: "Google Docs",
              providerLabel: "Google",
              category: "google",
              connectLabel: "Connect with Google",
              summary: "Read and create document workflows in Google Docs.",
              availability: "ready",
              scopes: ["https://www.googleapis.com/auth/documents", "openid", "email"],
            },
            {
              id: "google-calendar",
              title: "Google Calendar",
              providerLabel: "Google",
              category: "google",
              connectLabel: "Connect with Google",
              summary: "Calendar access.",
              availability: "ready",
              scopes: ["https://www.googleapis.com/auth/calendar", "openid", "email"],
            },
          ] as never,
        listAlisioConnectorAuthorizations: async () =>
          [
            {
              connectorId: "google-docs",
              state: "connected",
              health: "healthy",
              scopes: ["https://www.googleapis.com/auth/documents", "openid", "email"],
              connectedAccount: {
                label: "Nuno",
                email: "nuno@example.com",
              },
            },
            {
              connectorId: "google-calendar",
              state: "connected",
              health: "healthy",
              scopes: ["https://www.googleapis.com/auth/calendar", "openid", "email"],
              connectedAccount: {
                label: "Nuno",
                email: "nuno@example.com",
              },
            },
          ] as never,
        loadAlisioModelProviderSnapshot: async () =>
          ({
            catalog: [],
            dynamicSources: [],
            dynamicCatalogEntries: [],
            targets: [
              {
                targetId: "device-1::llama.cpp",
                deviceId: "device-1",
                label: "MacBook Pro",
                runtimeLabel: "Local GGUF",
                platform: "macOS",
                current: true,
                connected: true,
                location: "local",
                backend: "llama.cpp",
                runtimeKind: "llama.cpp",
                runtimeStatus: "ready",
                capabilities: {
                  install: true,
                  update: true,
                  uninstall: true,
                  consentRequired: false,
                },
                supportsInstall: true,
                supportsUpdate: true,
                supportsUninstall: true,
                consentRequired: false,
                installedModels: [{ id: "qwen", name: "Qwen" }],
                availableModels: [],
                recommendations: [],
              },
            ],
          }) as never,
        getActivePluginRegistry: () =>
          ({
            providers: [
              {
                pluginId: "openai",
                provider: {
                  id: "openai",
                  label: "OpenAI",
                  auth: [],
                  docsPath: "/providers/openai",
                },
              },
              {
                pluginId: "anthropic",
                provider: {
                  id: "anthropic",
                  label: "Anthropic",
                  auth: [],
                  docsPath: "/providers/anthropic",
                },
              },
            ],
            speechProviders: [
              {
                pluginId: "openai",
                provider: {
                  id: "openai",
                  label: "OpenAI",
                  isConfigured: () => true,
                  synthesize: vi.fn(),
                },
              },
            ],
            imageGenerationProviders: [
              {
                pluginId: "openai",
                provider: {
                  id: "openai",
                  label: "OpenAI",
                  capabilities: {
                    generate: {
                      prompt: true,
                    },
                    edit: {
                      prompt: true,
                      inputImage: true,
                    },
                  },
                  generateImage: vi.fn(),
                },
              },
            ],
            mediaUnderstandingProviders: [],
            webSearchProviders: [],
          }) as never,
        listRegisteredMemoryEmbeddingProviders: () =>
          [
            {
              adapter: {
                id: "openai",
                create: vi.fn(),
              },
              ownerPluginId: "openai",
            },
          ] as never,
        resolveProviderAuthOverview,
        loadProviderUsageSummary: async () =>
          ({
            updatedAt: Date.now(),
            providers: [
              {
                provider: "openai",
                displayName: "OpenAI",
                accountLabel: "Nuno",
                accountEmail: "nuno@example.com",
                plan: "Plus",
                windows: [
                  {
                    label: "5h",
                    usedPercent: 42,
                  },
                ],
              },
            ],
          }) as never,
      },
    });

    expect(result.summary.connected).toBeGreaterThanOrEqual(4);
    expect(result.assistant[0]?.status).toBe("connected");
    expect(result.providers.find((item) => item.id === "openai")?.chips).toContain("Speech");
    expect(result.providers.find((item) => item.id === "openai")?.chips).toContain("Image");
    expect(result.providers.find((item) => item.id === "anthropic")?.status).toBe("attention");
    expect(result.runtimes.map((item) => item.title)).toContain("MacBook Pro");
    expect(result.apps.find((item) => item.connectorId === "google-docs")?.status).toBe(
      "connected",
    );
    expect(result.apps.find((item) => item.connectorId === "google-calendar")?.status).toBe(
      "connected",
    );
    expect(result.apps.find((item) => item.connectorId === "google-calendar")?.active).toBe(true);
    expect(result.connectors.catalog).toHaveLength(2);
  });

  it("falls back quickly when usage or auth probes stall", async () => {
    vi.useFakeTimers();

    const never = new Promise<never>(() => undefined);
    const resultPromise = loadAlisioProviderOverview({
      usageTimeoutMs: 1,
      includeUsage: true,
      deps: {
        ensureAuthProfileStore: () =>
          ({
            version: 1,
            profiles: {},
          }) as never,
        readConfigFileSnapshot: async () =>
          ({
            path: "/tmp/models.json",
            valid: true,
            config: {
              models: {
                providers: {
                  openai: {},
                },
              },
            },
            runtimeConfig: {
              models: {
                providers: {
                  openai: {},
                },
              },
            },
          }) as never,
        getAlisioAccountState: async () =>
          ({
            profile: {
              username: "nuno",
              displayName: "Nuno",
              email: "nuno@example.com",
              avatarLabel: "N",
              joinedAt: new Date().toISOString(),
              plan: "free",
            },
            preferences: {
              language: "en",
              themeFamily: DEFAULT_THEME_FAMILY,
              themeMode: "system",
              themeAccents: DEFAULT_THEME_ACCENTS,
            },
            session: {
              state: "signed_in",
              profileCompleted: true,
            },
            devices: [],
            cloud: {
              backend: "supabase",
              available: true,
              missingEnvVars: [],
            },
          }) as never,
        getAlisioAiState: async () =>
          ({
            provider: "openai",
            status: "connected",
            profiles: [],
          }) as never,
        listAlisioConnectorDefinitions: () => [] as never,
        listAlisioConnectorAuthorizations: async () => [] as never,
        loadAlisioModelProviderSnapshot: async () =>
          ({
            catalog: [],
            dynamicSources: [],
            dynamicCatalogEntries: [],
            targets: [],
          }) as never,
        getActivePluginRegistry: () =>
          ({
            providers: [
              {
                pluginId: "openai",
                provider: {
                  id: "openai",
                  label: "OpenAI",
                  auth: [],
                  docsPath: "/providers/openai",
                },
              },
            ],
            speechProviders: [],
            imageGenerationProviders: [],
            mediaUnderstandingProviders: [],
            webSearchProviders: [],
          }) as never,
        listRegisteredMemoryEmbeddingProviders: () => [],
        resolveProviderAuthOverview,
        loadProviderUsageSummary: async () => await never,
      },
    });

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.providerId).toBe("openai");
    expect(result.providers[0]?.usageWindows).toEqual([]);
    expect(result.providers[0]?.status).toBe("ready");
  });

  it("keeps setup-required connectors visible as ready in the apps overview", async () => {
    const result = await loadAlisioProviderOverview({
      includeUsage: false,
      deps: {
        ensureAuthProfileStore: () =>
          ({
            version: 1,
            profiles: {},
          }) as never,
        readConfigFileSnapshot: async () =>
          ({
            path: "/tmp/models.json",
            valid: true,
            config: {},
            runtimeConfig: {},
          }) as never,
        getAlisioAccountState: async () =>
          ({
            profile: {
              username: "nuno",
              displayName: "Nuno",
              email: "nuno@example.com",
              avatarLabel: "N",
              joinedAt: new Date().toISOString(),
              plan: "free",
            },
            preferences: {
              language: "en",
              themeFamily: DEFAULT_THEME_FAMILY,
              themeMode: "system",
              themeAccents: DEFAULT_THEME_ACCENTS,
            },
            session: {
              state: "signed_in",
              profileCompleted: true,
            },
            devices: [],
            cloud: {
              backend: "supabase",
              available: true,
              missingEnvVars: [],
            },
          }) as never,
        getAlisioAiState: async () =>
          ({
            provider: "openai",
            status: "connected",
            profiles: [],
          }) as never,
        listAlisioConnectorDefinitions: () =>
          [
            {
              id: "stripe",
              title: "Stripe",
              providerLabel: "Stripe",
              category: "productivity",
              connectLabel: "Connect with Stripe",
              summary: "Payments and customer data.",
              availability: "ready",
              scopes: ["balance.read"],
            },
          ] as never,
        listAlisioConnectorAuthorizations: async () =>
          [
            {
              connectorId: "stripe",
              state: "not_connected",
              health: "config_missing",
              scopes: ["balance.read"],
            },
          ] as never,
        loadAlisioModelProviderSnapshot: async () =>
          ({
            catalog: [],
            dynamicSources: [],
            dynamicCatalogEntries: [],
            targets: [],
          }) as never,
        getActivePluginRegistry: () =>
          ({
            providers: [],
            speechProviders: [],
            imageGenerationProviders: [],
            mediaUnderstandingProviders: [],
            webSearchProviders: [],
          }) as never,
        listRegisteredMemoryEmbeddingProviders: () => [],
        resolveProviderAuthOverview,
        loadProviderUsageSummary: async () => null as never,
      },
    });

    expect(result.apps.find((item) => item.connectorId === "stripe")?.status).toBe("ready");
  });
});
