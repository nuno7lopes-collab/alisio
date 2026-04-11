import { ALISIO_LOCAL_MODEL_BACKEND } from "../shared/alisio-local-models.js";

export type LocalRuntimeKind = typeof ALISIO_LOCAL_MODEL_BACKEND;

export type RuntimeLocation = "local" | "node";

export interface InstalledModel {
  id: string;
  name: string;
  ownedBy?: string;
  running?: boolean;
}

export interface AvailableModel extends InstalledModel {
  runtimeKind: LocalRuntimeKind;
  summary?: string;
  parametersBillions?: number;
  quantization?: string;
  diskGb?: number;
  memoryGb?: number;
  recommendation?: {
    modelId: string;
    grade: "recommended" | "works" | "slow" | "unsupported";
    label: string;
    reason: string;
  };
}

export interface RuntimeCapabilities {
  install: boolean;
  update: boolean;
  uninstall: boolean;
  consentRequired: boolean;
}

export function buildRuntimeCapabilities(
  overrides?: Partial<RuntimeCapabilities>,
): RuntimeCapabilities {
  return {
    install: overrides?.install ?? false,
    update: overrides?.update ?? false,
    uninstall: overrides?.uninstall ?? false,
    consentRequired: overrides?.consentRequired ?? false,
  };
}
