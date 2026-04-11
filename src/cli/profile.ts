import os from "node:os";
import path from "node:path";
import { FLAG_TERMINATOR } from "../infra/cli-root-options.js";
import { runtimeEnvKey, readEnv } from "../infra/env.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { getPrimaryCommand } from "./argv.js";
import { isValidProfileName } from "./profile-utils.js";
import { forwardConsumedCliRootOption } from "./root-option-forward.js";
import { takeCliRootOptionValue } from "./root-option-value.js";

export type CliProfileParseResult =
  | { ok: true; profile: string | null; argv: string[] }
  | { ok: false; error: string };

export function parseCliProfileArgs(argv: string[]): CliProfileParseResult {
  if (argv.length < 2) {
    return { ok: true, profile: null, argv };
  }

  const out: string[] = argv.slice(0, 2);
  let profile: string | null = null;
  let sawDev = false;

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === FLAG_TERMINATOR) {
      out.push(arg, ...args.slice(i + 1));
      break;
    }

    if (arg === "--dev") {
      if (getPrimaryCommand(out) === "gateway") {
        out.push(arg);
        continue;
      }
      if (profile && profile !== "dev") {
        return { ok: false, error: "Cannot combine --dev with --profile" };
      }
      sawDev = true;
      profile = "dev";
      continue;
    }

    if (arg === "--profile" || arg.startsWith("--profile=")) {
      if (sawDev) {
        return { ok: false, error: "Cannot combine --dev with --profile" };
      }
      const next = args[i + 1];
      const { value, consumedNext } = takeCliRootOptionValue(arg, next);
      if (consumedNext) {
        i += 1;
      }
      if (!value) {
        return { ok: false, error: "--profile requires a value" };
      }
      if (!isValidProfileName(value)) {
        return {
          ok: false,
          error: 'Invalid --profile (use letters, numbers, "_", "-" only)',
        };
      }
      profile = value;
      continue;
    }

    const consumedRootOption = forwardConsumedCliRootOption(args, i, out);
    if (consumedRootOption > 0) {
      i += consumedRootOption - 1;
      continue;
    }

    out.push(arg);
  }

  return { ok: true, profile, argv: out };
}

function resolveProfileStateDir(
  profile: string,
  env: Record<string, string | undefined>,
  homedir: () => string,
): string {
  const suffix = profile.toLowerCase() === "default" ? "" : `-${profile}`;
  return path.join(resolveRequiredHomeDir(env as NodeJS.ProcessEnv, homedir), `.alisio${suffix}`);
}

export function applyCliProfileEnv(params: {
  profile: string;
  env?: Record<string, string | undefined>;
  homedir?: () => string;
}) {
  const env = params.env ?? (process.env as Record<string, string | undefined>);
  const homedir = params.homedir ?? os.homedir;
  const profile = params.profile.trim();
  if (!profile) {
    return;
  }

  // Convenience only: fill defaults, never override explicit env values.
  env.ALISIO_PROFILE = profile;
  env.ALISIO_PROFILE = profile;

  const stateDir =
    readEnv("ALISIO_STATE_DIR", {
      env: env as NodeJS.ProcessEnv,
      fallback: runtimeEnvKey("STATE_DIR"),
    }) || resolveProfileStateDir(profile, env, homedir);
  if (!env.ALISIO_STATE_DIR?.trim()) {
    env.ALISIO_STATE_DIR = stateDir;
  }
  if (!env.ALISIO_STATE_DIR?.trim()) {
    env.ALISIO_STATE_DIR = stateDir;
  }

  const configPath = path.join(stateDir, "alisio.json");
  if (!env.ALISIO_CONFIG_PATH?.trim()) {
    env.ALISIO_CONFIG_PATH = configPath;
  }
  if (!env.ALISIO_CONFIG_PATH?.trim()) {
    env.ALISIO_CONFIG_PATH = configPath;
  }

  const gatewayPort =
    profile === "dev"
      ? readEnv("ALISIO_GATEWAY_PORT", {
          env: env as NodeJS.ProcessEnv,
          fallback: runtimeEnvKey("GATEWAY_PORT"),
        }) || "19001"
      : undefined;
  if (gatewayPort && !env.ALISIO_GATEWAY_PORT?.trim()) {
    env.ALISIO_GATEWAY_PORT = gatewayPort;
  }
  if (gatewayPort && !env.ALISIO_GATEWAY_PORT?.trim()) {
    env.ALISIO_GATEWAY_PORT = gatewayPort;
  }
}
