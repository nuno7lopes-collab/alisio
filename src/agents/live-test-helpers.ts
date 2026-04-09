import { isTruthyEnvValue } from "../infra/env.js";

export const LIVE_OK_PROMPT = "Reply with the word ok.";
export const SHARED_LIVE_TEST_ENV_NAMES = [
  "ALISIO_LIVE_TEST",
  "OPENCLAW_LIVE_TEST",
  "LIVE",
] as const;
export const LIVE_PROFILE_KEY_ENV_NAMES = [
  "ALISIO_LIVE_REQUIRE_PROFILE_KEYS",
  "OPENCLAW_LIVE_REQUIRE_PROFILE_KEYS",
] as const;

export function readLiveEnv(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function isLiveEnvEnabled(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return names.some((name) => isTruthyEnvValue(env[name]));
}

export function isLiveTestEnabled(
  extraEnvVars: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isLiveEnvEnabled([...extraEnvVars, ...SHARED_LIVE_TEST_ENV_NAMES], env);
}

export function isLiveProfileKeyModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isLiveEnvEnabled(LIVE_PROFILE_KEY_ENV_NAMES, env);
}

export function createSingleUserPromptMessage(content = LIVE_OK_PROMPT) {
  return [
    {
      role: "user" as const,
      content,
      timestamp: Date.now(),
    },
  ];
}

export function extractNonEmptyAssistantText(
  content: Array<{
    type?: string;
    text?: string;
  }>,
) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}
