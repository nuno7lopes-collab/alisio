export type ModelProviderId = "openai" | "local";
export type ModelsAiProfileSort = "email-asc" | "recent" | "weekly-reset-asc" | "weekly-reset-desc";

export const DEFAULT_MODELS_AI_PROFILE_SORT: ModelsAiProfileSort = "email-asc";

export type ModelsOperationAction = "install" | "uninstall";
export type ModelsOperationIntent = "install" | "update" | "uninstall";
export type ModelsOperationPhase = "started" | "running" | "completed" | "failed";

export type ModelsOperation = {
  targetId: string;
  modelId: string;
  action: ModelsOperationAction;
  intent?: ModelsOperationIntent;
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
