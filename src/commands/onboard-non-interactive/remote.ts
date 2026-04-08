import { formatCliCommand } from "../../cli/command-format.js";
import type { AlisioConfig } from "../../config/config.js";
import { replaceConfigFile } from "../../config/config.js";
import { logConfigUpdated } from "../../config/logging.js";
import { type RuntimeEnv, writeRuntimeJson } from "../../runtime.js";
import { applyWizardMetadata } from "../onboard-helpers.js";
import type { OnboardOptions } from "../onboard-types.js";

export async function runNonInteractiveRemoteSetup(params: {
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  baseConfig: AlisioConfig;
  baseHash?: string;
}) {
  const { opts, runtime, baseConfig, baseHash } = params;
  const mode = "remote" as const;

  const remoteUrl = opts.remoteUrl?.trim();
  if (!remoteUrl) {
    runtime.error("Missing --remote-url for remote mode.");
    runtime.exit(1);
    return;
  }
  const remoteToken = opts.remoteToken?.trim();
  const remotePassword = opts.remotePassword?.trim();
  if (remoteToken && remotePassword) {
    runtime.error("Use either --remote-token or --remote-password, not both.");
    runtime.exit(1);
    return;
  }

  const existingRemote = baseConfig.gateway?.remote ?? {};
  let nextConfig: AlisioConfig = {
    ...baseConfig,
    gateway: {
      ...baseConfig.gateway,
      mode: "remote",
      remote: {
        ...existingRemote,
        url: remoteUrl,
        ...(remoteToken ? { token: remoteToken, password: undefined } : {}),
        ...(remotePassword ? { password: remotePassword, token: undefined } : {}),
      },
    },
  };
  nextConfig = applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await replaceConfigFile({
    nextConfig,
    ...(baseHash !== undefined ? { baseHash } : {}),
  });
  logConfigUpdated(runtime);

  const auth = nextConfig.gateway?.remote?.password
    ? "password"
    : nextConfig.gateway?.remote?.token
      ? "token"
      : "none";
  const payload = {
    mode,
    remoteUrl,
    auth,
  };
  if (opts.json) {
    writeRuntimeJson(runtime, payload);
  } else {
    runtime.log(`Remote gateway: ${remoteUrl}`);
    runtime.log(`Auth: ${payload.auth}`);
    runtime.log(
      `Tip: run \`${formatCliCommand("openclaw configure --section web")}\` to store your Brave API key for web_search. Docs: https://docs.openclaw.ai/tools/web`,
    );
  }
}
