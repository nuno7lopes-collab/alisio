export const ALISIO_RUNTIME_READY_CONNECTOR_IDS = [
  "gmail-modify",
  "gmail-read",
  "gmail-send",
  "github",
  "google-calendar",
  "google-analytics",
  "google-docs",
  "google-drive",
  "google-forms",
  "google-sheets",
  "stripe",
  "youtube",
] as const;

const RUNTIME_READY_CONNECTOR_IDS: ReadonlySet<string> = new Set(
  ALISIO_RUNTIME_READY_CONNECTOR_IDS,
);

export function isAlisioConnectorRuntimeReady(connectorId: string): boolean {
  return RUNTIME_READY_CONNECTOR_IDS.has(connectorId.trim());
}
