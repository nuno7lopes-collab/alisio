export type ModelProviderId = "openai" | "local";

export type ModelsOperationAction = "install" | "uninstall";
export type ModelsOperationPhase = "started" | "running" | "completed" | "failed";

export type ModelsOperation = {
  targetId: string;
  modelId: string;
  action: ModelsOperationAction;
  phase: ModelsOperationPhase;
  percent?: number;
  downloadedSize?: number;
  totalSize?: number;
  message?: string;
  updatedAt: number;
};

export type ModelsOperationMap = Record<string, ModelsOperation>;

export function makeModelsOperationKey(targetId: string, modelId: string) {
  return `${targetId.trim().toLowerCase()}::${modelId.trim().toLowerCase()}`;
}
