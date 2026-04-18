import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveManifestProviderAuthChoice = vi.hoisted(() => vi.fn());
const resolveProviderPluginChoice = vi.hoisted(() => vi.fn());
const resolvePluginProviders = vi.hoisted(() => vi.fn(() => []));

vi.mock("../plugins/provider-auth-choices.js", () => ({
  resolveManifestProviderAuthChoice,
}));

vi.mock("../plugins/provider-auth-choice.runtime.js", () => ({
  resolveProviderPluginChoice,
  resolvePluginProviders,
}));

import { resolvePreferredProviderForAuthChoice } from "../plugins/provider-auth-choice-preference.js";

describe("resolvePreferredProviderForAuthChoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveManifestProviderAuthChoice.mockReturnValue(undefined);
    resolvePluginProviders.mockReturnValue([]);
    resolveProviderPluginChoice.mockReturnValue(null);
  });

  it("prefers manifest metadata when available", async () => {
    resolveManifestProviderAuthChoice.mockReturnValue({
      pluginId: "openai",
      providerId: "openai",
      methodId: "api-key",
      choiceId: "openai-api-key",
      choiceLabel: "OpenAI API key",
    });

    await expect(resolvePreferredProviderForAuthChoice({ choice: "openai-api-key" })).resolves.toBe(
      "openai",
    );
    expect(resolvePluginProviders).not.toHaveBeenCalled();
  });

  it("falls back to runtime plugin lookup when manifest metadata is absent", async () => {
    const env = { ALISIO_AUTH_CHOICE_TEST: "1" } as NodeJS.ProcessEnv;
    const providers = [{ id: "demo-provider" }];
    resolvePluginProviders.mockReturnValue(providers as never);
    resolveProviderPluginChoice.mockReturnValue({
      provider: { id: "demo-provider" },
    } as never);

    await expect(
      resolvePreferredProviderForAuthChoice({ choice: "demo-provider-api-key", env }),
    ).resolves.toBe("demo-provider");
    expect(resolvePluginProviders).toHaveBeenCalledWith({
      config: undefined,
      workspaceDir: undefined,
      env,
      bundledProviderAllowlistCompat: true,
      bundledProviderVitestCompat: true,
    });
    expect(resolveProviderPluginChoice).toHaveBeenCalledWith({
      providers,
      choice: "demo-provider-api-key",
    });
  });

  it("uses manifest metadata for plugin-owned choices", async () => {
    resolveManifestProviderAuthChoice.mockReturnValue({
      pluginId: "chutes",
      providerId: "chutes",
      methodId: "oauth",
      choiceId: "chutes",
      choiceLabel: "Chutes OAuth",
    });

    await expect(resolvePreferredProviderForAuthChoice({ choice: "chutes" })).resolves.toBe(
      "chutes",
    );
    expect(resolvePluginProviders).not.toHaveBeenCalled();
  });

  it("maps custom-api-key to the custom provider when no plugin choice matches", async () => {
    await expect(resolvePreferredProviderForAuthChoice({ choice: "custom-api-key" })).resolves.toBe(
      "custom",
    );
  });
});
