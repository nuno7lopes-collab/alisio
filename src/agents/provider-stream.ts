import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../config/config.js";
import { resolveProviderStreamFn } from "../plugins/provider-runtime.js";
import { isAlisioDynamicProvider } from "../shared/alisio-remote-model-provider.js";
import { resolveAlisioProviderStream } from "./alisio-provider-stream.js";
import { ensureCustomApiRegistered } from "./custom-api-registry.js";

export function registerProviderStreamForModel<TApi extends Api>(params: {
  model: Model<TApi>;
  cfg?: OpenClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): StreamFn | undefined {
  const alisioStreamFn: StreamFn = async (model, context, options) => {
    const stream = await resolveAlisioProviderStream(model as Model<string>, context, options);
    if (!stream) {
      throw new Error(`dynamic provider stream not found for ${params.model.provider}`);
    }
    return stream;
  };
  if (isAlisioDynamicProvider(params.model.provider)) {
    ensureCustomApiRegistered(params.model.api, alisioStreamFn);
    return alisioStreamFn;
  }
  const streamFn = resolveProviderStreamFn({
    provider: params.model.provider,
    config: params.cfg,
    workspaceDir: params.workspaceDir,
    env: params.env,
    context: {
      config: params.cfg,
      agentDir: params.agentDir,
      workspaceDir: params.workspaceDir,
      provider: params.model.provider,
      modelId: params.model.id,
      model: params.model,
    },
  });
  if (!streamFn) {
    return undefined;
  }
  ensureCustomApiRegistered(params.model.api, streamFn);
  return streamFn;
}
