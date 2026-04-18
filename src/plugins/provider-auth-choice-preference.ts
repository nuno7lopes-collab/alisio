import type { AlisioConfig } from "../config/config.js";
import { resolveManifestProviderAuthChoice } from "./provider-auth-choices.js";

export async function resolvePreferredProviderForAuthChoice(params: {
  choice: string;
  config?: AlisioConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  const manifestResolved = resolveManifestProviderAuthChoice(params.choice, params);
  if (manifestResolved) {
    return manifestResolved.providerId;
  }

  const { resolveProviderPluginChoice, resolvePluginProviders } =
    await import("./provider-auth-choice.runtime.js");
  const providers = resolvePluginProviders({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
    bundledProviderAllowlistCompat: true,
    bundledProviderVitestCompat: true,
  });
  const pluginResolved = resolveProviderPluginChoice({
    providers,
    choice: params.choice,
  });
  if (pluginResolved) {
    return pluginResolved.provider.id;
  }

  if (params.choice === "custom-api-key") {
    return "custom";
  }
  return undefined;
}
