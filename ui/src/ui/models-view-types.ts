export type ModelsServerKind = "openai-compatible" | "ollama";

export type ModelsServerDraft = {
  mode: "create" | "edit";
  serverId?: string;
  label: string;
  kind: ModelsServerKind;
  baseUrl: string;
  apiKey: string;
};
