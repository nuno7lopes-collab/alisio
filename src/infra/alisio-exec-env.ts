export const ALISIO_CLI_ENV_VAR = "ALISIO_CLI";
export const ALISIO_CLI_ENV_VALUE = "1";

export function markAlisioExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [ALISIO_CLI_ENV_VAR]: ALISIO_CLI_ENV_VALUE,
  };
}

export function ensureAlisioExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[ALISIO_CLI_ENV_VAR] = ALISIO_CLI_ENV_VALUE;
  return env;
}
