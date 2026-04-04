export const ALISIO_LOCAL_MODEL_BACKEND = "llama.cpp" as const;

export type AlisioLocalModelReleaseStage = "hidden" | "published";

export type AlisioLocalModelCatalogEntry = {
  id: string;
  slug: string;
  family: string;
  name: string;
  parametersBillions: number;
  quantization: string;
  backend: typeof ALISIO_LOCAL_MODEL_BACKEND;
  summary: string;
  diskGb: number;
  memoryGb: number;
  vramGb?: number;
  releaseStage: AlisioLocalModelReleaseStage;
  sourceUri: string;
};

const ALISIO_LOCAL_MODEL_CATALOG: readonly AlisioLocalModelCatalogEntry[] = [
  {
    id: "qwen3-4b-q4-k-m",
    slug: "qwen3-4b-q4-k-m",
    family: "Qwen",
    name: "Qwen3 4B",
    parametersBillions: 4,
    quantization: "Q4_K_M",
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    summary: "Perfil leve para portáteis e máquinas do dia a dia.",
    diskGb: 3.3,
    memoryGb: 8,
    releaseStage: "published",
    sourceUri: "hf:Qwen/Qwen3-4B-GGUF:Q4_K_M",
  },
  {
    id: "qwen3-8b-q4-k-m",
    slug: "qwen3-8b-q4-k-m",
    family: "Qwen",
    name: "Qwen3 8B",
    parametersBillions: 8,
    quantization: "Q4_K_M",
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    summary: "Equilíbrio recomendado entre qualidade, velocidade e memória.",
    diskGb: 5.1,
    memoryGb: 12,
    vramGb: 8,
    releaseStage: "published",
    sourceUri: "hf:Qwen/Qwen3-8B-GGUF:Q4_K_M",
  },
  {
    id: "qwen3-32b-q4-k-m",
    slug: "qwen3-32b-q4-k-m",
    family: "Qwen",
    name: "Qwen3 32B",
    parametersBillions: 32,
    quantization: "Q4_K_M",
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    summary: "Perfil máximo para desktops fortes e computadores dedicados a IA local.",
    diskGb: 19.8,
    memoryGb: 32,
    vramGb: 20,
    releaseStage: "published",
    sourceUri: "hf:Qwen/Qwen3-32B-GGUF:Q4_K_M",
  },
];

export function listAlisioLocalModelCatalog(): readonly AlisioLocalModelCatalogEntry[] {
  return ALISIO_LOCAL_MODEL_CATALOG;
}

export function listPublishedAlisioLocalModels(): readonly AlisioLocalModelCatalogEntry[] {
  return ALISIO_LOCAL_MODEL_CATALOG.filter((entry) => entry.releaseStage === "published");
}

export function findAlisioLocalModelCatalogEntry(
  modelId: string,
): AlisioLocalModelCatalogEntry | null {
  const normalizedId = modelId.trim().toLowerCase();
  return (
    ALISIO_LOCAL_MODEL_CATALOG.find(
      (entry) =>
        entry.id.toLowerCase() === normalizedId || entry.slug.toLowerCase() === normalizedId,
    ) ?? null
  );
}
