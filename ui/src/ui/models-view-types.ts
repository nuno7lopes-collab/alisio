export type ModelsServerKind = "openai-compatible" | "ollama";

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

export type ModelsServerDraft = {
  mode: "create" | "edit";
  serverId?: string;
  label: string;
  kind: ModelsServerKind;
  baseUrl: string;
  apiKey: string;
};

export function makeModelsOperationKey(targetId: string, modelId: string) {
  return `${targetId.trim().toLowerCase()}::${modelId.trim().toLowerCase()}`;
}
