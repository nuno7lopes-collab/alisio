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
};

const ALISIO_LOCAL_MODEL_CATALOG: readonly AlisioLocalModelCatalogEntry[] = [
  {
    id: "qwen-8b-q6-k",
    slug: "qwen-8b-q6-k",
    family: "Qwen",
    name: "Qwen 8B",
    parametersBillions: 8,
    quantization: "Q6_K",
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    summary: "Perfil intermédio para chat local com boa qualidade e menor custo.",
    diskGb: 7.4,
    memoryGb: 12,
    releaseStage: "hidden",
  },
  {
    id: "qwen-14b-q5-k-m",
    slug: "qwen-14b-q5-k-m",
    family: "Qwen",
    name: "Qwen 14B",
    parametersBillions: 14,
    quantization: "Q5_K_M",
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    summary: "Perfil equilibrado para uso diário com contexto e raciocínio mais fortes.",
    diskGb: 11.8,
    memoryGb: 18,
    vramGb: 12,
    releaseStage: "hidden",
  },
  {
    id: "qwen-32b-q4-k-m",
    slug: "qwen-32b-q4-k-m",
    family: "Qwen",
    name: "Qwen 32B",
    parametersBillions: 32,
    quantization: "Q4_K_M",
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    summary: "Perfil máximo aprovado para máquinas mais fortes ou desktops dedicados.",
    diskGb: 20.6,
    memoryGb: 32,
    vramGb: 20,
    releaseStage: "hidden",
  },
];

export function listAlisioLocalModelCatalog(): readonly AlisioLocalModelCatalogEntry[] {
  return ALISIO_LOCAL_MODEL_CATALOG;
}

export function listPublishedAlisioLocalModels(): readonly AlisioLocalModelCatalogEntry[] {
  return ALISIO_LOCAL_MODEL_CATALOG.filter((entry) => entry.releaseStage === "published");
}
