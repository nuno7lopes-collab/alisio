import { normalizeProviderId } from "../agents/model-selection.js";
import type { AlisioConfig } from "../config/config.js";
import {
  resolveProviderPluginChoice,
  resolvePluginProviders,
} from "../plugins/provider-auth-choice.runtime.js";

export type AuthChoiceModelSelectionPolicy = {
  preferredProvider?: string;
  promptWhenAuthChoiceProvided: boolean;
  allowKeepCurrent: boolean;
};

export async function resolveAuthChoiceModelSelectionPolicy(params: {
  authChoice: string;
  config: AlisioConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  resolvePreferredProviderForAuthChoice: (params: {
    choice: string;
    config?: AlisioConfig;
    workspaceDir?: string;
    env?: NodeJS.ProcessEnv;
  }) => Promise<string | undefined>;
}): Promise<AuthChoiceModelSelectionPolicy> {
  const preferredProvider = await params.resolvePreferredProviderForAuthChoice({
    choice: params.authChoice,
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  });

  const providers = resolvePluginProviders({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
    bundledProviderAllowlistCompat: true,
    bundledProviderVitestCompat: true,
  });
  const resolvedChoice = resolveProviderPluginChoice({
    providers,
    choice: params.authChoice,
  });
  const matchedProvider =
    resolvedChoice?.provider ??
    (preferredProvider
      ? providers.find(
          (provider) => normalizeProviderId(provider.id) === normalizeProviderId(preferredProvider),
        )
      : undefined);
  const setupPolicy =
    resolvedChoice?.wizard?.modelSelection ?? matchedProvider?.wizard?.setup?.modelSelection;

  return {
    preferredProvider,
    promptWhenAuthChoiceProvided: setupPolicy?.promptWhenAuthChoiceProvided === true,
    allowKeepCurrent: setupPolicy?.allowKeepCurrent ?? true,
  };
}
