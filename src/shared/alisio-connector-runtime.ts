const RUNTIME_READY_CONNECTOR_IDS = new Set([
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
  "youtube",
]);

export function isAlisioConnectorRuntimeReady(connectorId: string): boolean {
  return RUNTIME_READY_CONNECTOR_IDS.has(connectorId.trim());
}
