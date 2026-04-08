import { type ChatChannelId, normalizeChatChannelId } from "../channels/registry.js";
import type { AlisioConfig } from "../config/config.js";
import { loadConfig, writeConfigFile } from "../config/config.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import {
  createChannelOnboardingPostWriteHookCollector,
  runCollectedChannelOnboardingPostWriteHooks,
  setupChannels,
} from "../flows/channel-setup.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

export type ChannelWizardStartOptions = {
  channel: string;
};

export async function runChannelSetupWizard(params: {
  opts: ChannelWizardStartOptions;
  runtime: RuntimeEnv;
  prompter: WizardPrompter;
  startChannel: (channel: ChatChannelId, accountId?: string) => Promise<void>;
  loadCurrentConfig?: () => AlisioConfig;
  writeNextConfig?: typeof writeConfigFile;
}) {
  const resolvedChannel = normalizeChatChannelId(params.opts.channel);
  if (!resolvedChannel) {
    throw new Error(`Unknown channel: ${params.opts.channel}`);
  }

  const readConfig =
    params.loadCurrentConfig ??
    (() =>
      applyPluginAutoEnable({
        config: loadConfig(),
        env: process.env,
      }).config);
  const persistConfig = params.writeNextConfig ?? writeConfigFile;

  const cfg = readConfig();
  const postWriteHooks = createChannelOnboardingPostWriteHookCollector();
  let resolvedAccountId: string | undefined;

  const nextConfig = await setupChannels(cfg, params.runtime, params.prompter, {
    surface: "channel",
    allowDisable: false,
    skipConfirm: true,
    skipStatusNote: true,
    skipDmPolicyPrompt: true,
    skipSelectionPrompt: true,
    initialSelection: [resolvedChannel],
    onPostWriteHook: (hook) => {
      postWriteHooks.collect(hook);
    },
    onAccountId: (channel, accountId) => {
      if (channel === resolvedChannel) {
        resolvedAccountId = accountId;
      }
    },
  });

  await persistConfig(nextConfig);
  await runCollectedChannelOnboardingPostWriteHooks({
    hooks: postWriteHooks.drain(),
    cfg: nextConfig,
    runtime: params.runtime,
  });
  await params.startChannel(resolvedChannel, resolvedAccountId);

  await params.prompter.outro(
    resolvedChannel === "whatsapp"
      ? "Configuração guardada. Continua no QR para concluir a ligação do WhatsApp."
      : "Configuração guardada. O canal vai aparecer na página de Canais assim que estiver pronto.",
  );
}
