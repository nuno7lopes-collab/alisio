export const TALK_SILENCE_TIMEOUT_MS_BY_PLATFORM = {
  macos: 700,
} as const;

export function describeTalkSilenceTimeoutDefaults(): string {
  const macos = TALK_SILENCE_TIMEOUT_MS_BY_PLATFORM.macos;
  return `${macos} ms on macOS`;
}
