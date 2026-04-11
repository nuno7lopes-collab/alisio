export function resolveDaemonContainerContext(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.ALISIO_CONTAINER_HINT?.trim() || env.ALISIO_CONTAINER?.trim() || null;
}
