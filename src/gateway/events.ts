import type { UpdateAvailable } from "../infra/update-startup.js";

export const GATEWAY_EVENT_UPDATE_AVAILABLE = "update.available" as const;
export const GATEWAY_EVENT_ALISIO_MODELS_OPERATION = "alisio.models.operation" as const;

export type GatewayUpdateAvailableEventPayload = {
  updateAvailable: UpdateAvailable | null;
};

export type GatewayAlisioModelsOperationEventPayload = {
  targetId: string;
  modelId: string;
  action: "install" | "uninstall";
  phase: "started" | "running" | "completed" | "failed";
  percent?: number;
  downloadedSize?: number;
  totalSize?: number;
  message?: string;
};
