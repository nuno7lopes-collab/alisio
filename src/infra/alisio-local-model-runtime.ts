import {
  ALISIO_LOCAL_MODEL_BACKEND,
  listPublishedAlisioLocalModels,
} from "../shared/alisio-local-models.js";
import {
  type AvailableModel,
  type InstalledModel,
  type LocalRuntimeKind,
  type RuntimeCapabilities,
} from "./local-model-runtime-contracts.js";
import type { AlisioModelHardwareProfile, AlisioModelRecommendation } from "./model-hardware.js";
import { summarizeHardwareRecommendation } from "./model-hardware.js";

export type AlisioInstalledLocalModel = InstalledModel;

export type AlisioLocalModelRuntimeStatus = "ready" | "not_configured" | "error";
export type AlisioLocalRuntimeKind = LocalRuntimeKind;

export type AlisioAvailableLocalModel = AvailableModel & {
  recommendation?: AlisioModelRecommendation;
};

export type AlisioLocalModelRuntimeInspection = {
  backend: typeof ALISIO_LOCAL_MODEL_BACKEND;
  runtimeKind: AlisioLocalRuntimeKind;
  runtimeLabel: string;
  status: AlisioLocalModelRuntimeStatus;
  message?: string;
  models: AlisioInstalledLocalModel[];
  availableModels: AlisioAvailableLocalModel[];
  hardware?: AlisioModelHardwareProfile;
  capabilities: RuntimeCapabilities;
  supportsInstall: boolean;
  supportsUpdate: boolean;
  supportsUninstall: boolean;
  consentRequired: boolean;
};

type SuggestedLocalModelCatalogEntry = {
  id: string;
  name: string;
  runtimeKind: typeof ALISIO_LOCAL_MODEL_BACKEND;
  summary: string;
  parametersBillions: number;
  quantization?: string;
  diskGb: number;
  memoryGb: number;
  ownedBy?: string;
};

const publishedMarketplaceCatalog = listPublishedAlisioLocalModels();

function buildSuggestedAvailableModels(
  catalog: readonly SuggestedLocalModelCatalogEntry[],
  hardware: AlisioModelHardwareProfile | undefined,
): AlisioAvailableLocalModel[] {
  const recommendationById = new Map<string, AlisioModelRecommendation>();
  if (hardware) {
    const summarized = summarizeHardwareRecommendation(hardware, catalog);
    for (const recommendation of summarized.recommendations) {
      recommendationById.set(recommendation.modelId, recommendation);
    }
  }

  return catalog.map((entry) => ({
    id: entry.id,
    name: entry.name,
    runtimeKind: entry.runtimeKind,
    summary: entry.summary,
    ownedBy: entry.ownedBy,
    parametersBillions: entry.parametersBillions,
    quantization: entry.quantization,
    diskGb: entry.diskGb,
    memoryGb: entry.memoryGb,
    recommendation: recommendationById.get(entry.id),
  }));
}

export function listManagedLocalAvailableModels(
  hardware?: AlisioModelHardwareProfile,
): AlisioAvailableLocalModel[] {
  return buildSuggestedAvailableModels(
    publishedMarketplaceCatalog.map((entry) => ({
      id: entry.id,
      name: entry.name,
      runtimeKind: ALISIO_LOCAL_MODEL_BACKEND,
      summary: entry.summary,
      parametersBillions: entry.parametersBillions,
      quantization: entry.quantization,
      diskGb: entry.diskGb,
      memoryGb: entry.memoryGb,
      ownedBy: entry.backend,
    })),
    hardware,
  );
}
