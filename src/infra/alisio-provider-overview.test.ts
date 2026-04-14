import { describe, expect, it, vi } from "vitest";
import { resolveProviderAuthOverview } from "../commands/models/list.auth-overview.js";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { loadAlisioProviderOverview } from "./alisio-provider-overview.js";

describe("loadAlisioProviderOverview", () => {
  it("builds a unified overview from real provider, runtime, and connector signals", async () => {
    const result = await loadAlisioProviderOverview({
      usageTimeoutMs: 10,
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
              id: "google-calendar",
              title: "Google Calendar",
              providerLabel: "Google",
              category: "google",
              connectLabel: "Connect with Google",
              summary: "Calendar access.",
              availability: "ready",
              scopes: ["openid", "email"],
            },
          ] as never,
        listAlisioConnectorAuthorizations: async () =>
          [
            {
              connectorId: "google-calendar",
              state: "connected",
              health: "healthy",
              scopes: ["openid", "email"],
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
        hasAvailableAuthForProvider: async ({ provider }) => provider !== "anthropic",
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
    expect(result.apps[0]?.connectorId).toBe("google-calendar");
    expect(result.connectors.catalog).toHaveLength(1);
  });
});
