import os from "node:os";
import type { AlisioLocalModelCatalogEntry } from "../shared/alisio-local-models.js";

export type AlisioModelHardwareProfile = {
  platform: NodeJS.Platform;
  architecture: string;
  totalMemoryGb: number;
  cpuCores: number;
};

export type AlisioModelRecommendationGrade = "recommended" | "works" | "slow" | "unsupported";

export type AlisioModelRecommendation = {
  modelId: string;
  grade: AlisioModelRecommendationGrade;
  label: string;
  reason: string;
};

export function inspectLocalModelHardwareProfile(): AlisioModelHardwareProfile {
  return {
    platform: process.platform,
    architecture: process.arch,
    totalMemoryGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    cpuCores: os.cpus().length,
  };
}

function resolveMemoryHeadroom(profile: AlisioModelHardwareProfile, requiredGb: number) {
  if (requiredGb <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return profile.totalMemoryGb / requiredGb;
}

function resolveCpuHeadroom(profile: AlisioModelHardwareProfile, parametersBillions: number) {
  if (parametersBillions <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const divisor = parametersBillions >= 30 ? 4 : parametersBillions >= 8 ? 2 : 1;
  return profile.cpuCores / divisor;
}

export function recommendModelForHardware(
  profile: AlisioModelHardwareProfile,
  entry: Pick<AlisioLocalModelCatalogEntry, "id" | "memoryGb" | "parametersBillions" | "name">,
): AlisioModelRecommendation {
  const memoryHeadroom = resolveMemoryHeadroom(profile, entry.memoryGb);
  const cpuHeadroom = resolveCpuHeadroom(profile, entry.parametersBillions);

  if (memoryHeadroom >= 1.5 && cpuHeadroom >= 4) {
    return {
      modelId: entry.id,
      grade: "recommended",
      label: "Recomendado",
      reason: `${profile.totalMemoryGb} GB RAM e ${profile.cpuCores} cores dão boa margem para ${entry.name}.`,
    };
  }

  if (memoryHeadroom >= 1.1 && cpuHeadroom >= 2) {
    return {
      modelId: entry.id,
      grade: "works",
      label: "Funciona bem",
      reason: `${entry.name} deve correr de forma estável neste computador.`,
    };
  }

  if (memoryHeadroom >= 0.85 && cpuHeadroom >= 1) {
    return {
      modelId: entry.id,
      grade: "slow",
      label: "Lento",
      reason: `${entry.name} pode correr, mas com resposta mais lenta e menos margem.`,
    };
  }

  return {
    modelId: entry.id,
    grade: "unsupported",
    label: "Não recomendado",
    reason: `${entry.name} pede mais memória ou CPU do que este computador costuma aguentar bem.`,
  };
}

export function summarizeHardwareRecommendation(
  profile: AlisioModelHardwareProfile,
  catalog: readonly AlisioLocalModelCatalogEntry[],
) {
  const ranked = catalog
    .map((entry) => ({
      entry,
      recommendation: recommendModelForHardware(profile, entry),
    }))
    .toSorted((left, right) => {
      const gradeScore = {
        recommended: 4,
        works: 3,
        slow: 2,
        unsupported: 1,
      } as const;
      const gradeDiff =
        gradeScore[right.recommendation.grade] - gradeScore[left.recommendation.grade];
      if (gradeDiff !== 0) {
        return gradeDiff;
      }
      return right.entry.parametersBillions - left.entry.parametersBillions;
    });

  return {
    profile,
    recommendations: ranked.map((item) => item.recommendation),
    bestModel: ranked.find((item) => item.recommendation.grade !== "unsupported")?.entry ?? null,
  };
}
